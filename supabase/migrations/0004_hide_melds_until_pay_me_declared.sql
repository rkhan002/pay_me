-- Melds are now private to their owner until someone calls Pay Me (the
-- hand's phase moves out of "playing"), matching the server-side rule
-- added to applyLayoff/unmeld in the rules-engine: during ordinary play a
-- meld can only be built on (or unmelded) by its owner, since no one else
-- can see it yet. Once revealed, everyone can see every meld, same as
-- before.

drop policy "room members can read melds" on melds;

create policy "melds visible to owner, or to everyone after reveal" on melds
for select
using (
  exists (
    select 1 from players p
    where p.id = melds.owner_player_id
      and p.user_id = auth.uid()
  )
  or exists (
    select 1 from hands h
    where h.id = melds.hand_id
      and h.phase <> 'playing'
      and private.is_room_member(h.room_id)
  )
);

drop policy "room members can read meld cards" on meld_cards;

create policy "meld cards visible to owner, or to everyone after reveal" on meld_cards
for select
using (
  exists (
    select 1 from melds m
    join players p on p.id = m.owner_player_id
    where m.id = meld_cards.meld_id
      and p.user_id = auth.uid()
  )
  or exists (
    select 1 from melds m
    join hands h on h.id = m.hand_id
    where m.id = meld_cards.meld_id
      and h.phase <> 'playing'
      and private.is_room_member(h.room_id)
  )
);
