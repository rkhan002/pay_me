-- Pay Me: server-authoritative schema.
--
-- Design notes:
-- * All writes happen through Edge Functions running with the service_role
--   key, which bypasses RLS entirely. The policies below only govern what
--   anonymous-auth clients may SELECT directly (for the initial page load
--   and for Postgres Changes realtime subscriptions).
-- * "stock" (the face-down draw pile order) lives in its own table with NO
--   client-facing policies at all, so it is never selectable by anon/
--   authenticated roles under any circumstance - only service_role can see it.
-- * Each player's hand is private: hand_players.hand_cards is readable only
--   by that player. A public view exposes card counts (not contents) so
--   opponents can render "player has N cards left".
--
-- Requires: enable "Anonymous sign-ins" in Supabase Auth settings so
-- auth.uid() is populated for players without a real account.

create extension if not exists pgcrypto;

create table rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  status text not null default 'lobby' check (status in ('lobby', 'in_progress', 'complete')),
  max_players int not null default 8 check (max_players between 2 and 8),
  current_hand_number int not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms (id) on delete cascade,
  user_id uuid not null,
  seat_index int not null,
  display_name text not null,
  connected boolean not null default true,
  joined_at timestamptz not null default now(),
  unique (room_id, seat_index),
  unique (room_id, user_id)
);

create table hands (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms (id) on delete cascade,
  hand_number int not null,
  wild_rank text not null,
  deal_size int not null,
  discard_pile jsonb not null default '[]'::jsonb,
  turn_player_id uuid references players (id),
  has_drawn_this_turn boolean not null default false,
  phase text not null default 'playing'
    check (phase in ('playing', 'final_turns', 'layoff', 'scoring', 'complete')),
  pay_me_caller_id uuid references players (id),
  -- Player ids (not seats) still owed a turn in the current phase, in order.
  pending_final_turns uuid[] not null default '{}',
  pending_layoffs uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (room_id, hand_number)
);

-- Server-only: the face-down stock. No SELECT policy is granted to any
-- client-facing role, so PostgREST returns nothing for anon/authenticated -
-- only Edge Functions using the service_role key can read or write this.
create table hand_stock (
  hand_id uuid primary key references hands (id) on delete cascade,
  stock jsonb not null default '[]'::jsonb
);

create table hand_players (
  id uuid primary key default gen_random_uuid(),
  hand_id uuid not null references hands (id) on delete cascade,
  player_id uuid not null references players (id) on delete cascade,
  hand_cards jsonb not null default '[]'::jsonb,
  score int,
  has_taken_final_turn boolean not null default false,
  unique (hand_id, player_id)
);

create table melds (
  id uuid primary key default gen_random_uuid(),
  hand_id uuid not null references hands (id) on delete cascade,
  owner_player_id uuid not null references players (id),
  meld_type text not null check (meld_type in ('SET', 'RUN')),
  created_at timestamptz not null default now()
);

create table meld_cards (
  id uuid primary key default gen_random_uuid(),
  meld_id uuid not null references melds (id) on delete cascade,
  rank text not null,
  suit text,
  deck_index int not null,
  position int not null,
  added_by_player_id uuid not null references players (id),
  added_at timestamptz not null default now()
);

-- Append-only audit log of every validated intent. Service-role only; not
-- exposed to clients. Useful for anti-cheat review and debugging.
create table moves (
  id uuid primary key default gen_random_uuid(),
  hand_id uuid not null references hands (id) on delete cascade,
  player_id uuid not null references players (id),
  action text not null
    check (action in ('draw_stock', 'draw_discard', 'discard', 'propose_meld', 'layoff', 'pass_layoff')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_players_room on players (room_id);
create index idx_hands_room on hands (room_id);
create index idx_hand_players_hand on hand_players (hand_id);
create index idx_melds_hand on melds (hand_id);
create index idx_meld_cards_meld on meld_cards (meld_id);
create index idx_moves_hand on moves (hand_id);

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------

alter table rooms enable row level security;
alter table players enable row level security;
alter table hands enable row level security;
alter table hand_stock enable row level security;
alter table hand_players enable row level security;
alter table melds enable row level security;
alter table meld_cards enable row level security;
alter table moves enable row level security;

-- hand_stock, moves: no policies created -> default deny for anon/authenticated.
-- Only service_role (used by Edge Functions) can read/write them.

create function is_room_member(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from players
    where room_id = target_room_id and user_id = auth.uid()
  );
$$;

create policy "room members can read their room" on rooms
  for select using (is_room_member(id));

create policy "room members can read the seat list" on players
  for select using (is_room_member(room_id));

create policy "room members can read public hand state" on hands
  for select using (is_room_member(room_id));

create policy "room members can read melds" on melds
  for select using (
    exists (select 1 from hands h where h.id = melds.hand_id and is_room_member(h.room_id))
  );

create policy "room members can read meld cards" on meld_cards
  for select using (
    exists (
      select 1 from melds m
      join hands h on h.id = m.hand_id
      where m.id = meld_cards.meld_id and is_room_member(h.room_id)
    )
  );

-- A player may only ever read their OWN hand_cards.
create policy "players can read only their own hand" on hand_players
  for select using (
    exists (select 1 from players p where p.id = hand_players.player_id and p.user_id = auth.uid())
  );

-- Public view: card counts + score/turn-status for every player in a hand,
-- with no card contents - safe for every room member to read, so opponents
-- can render "3 cards left" without ever seeing what those cards are.
--
-- Deliberately NOT security_invoker: this view must run with the view
-- owner's privileges so it can read across hand_players rows that the
-- querying player doesn't own (RLS on hand_players itself is owner-only).
-- Access control here comes entirely from the `is_room_member` filter below,
-- not from hand_players' RLS.
create view hand_player_public as
select
  hp.hand_id,
  hp.player_id,
  jsonb_array_length(hp.hand_cards) as card_count,
  hp.score,
  hp.has_taken_final_turn
from hand_players hp
join hands h on h.id = hp.hand_id
where is_room_member(h.room_id);

grant select on hand_player_public to anon, authenticated;
