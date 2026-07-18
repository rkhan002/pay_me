-- Updated reveal timing: no player's melds are shown to opponents until the
-- lay-off round begins (hand phase is layoff/scoring/complete) - i.e. only
-- once every player has finished their final turn. This replaces migration
-- 0006, which revealed non-caller melds as soon as Pay Me was declared and
-- revealed the Pay Me caller's melds per-viewer during final_turns. Now the
-- owner always sees their own meld; everyone else sees nothing until layoff.

drop policy "melds visible to owner, or per pay-me reveal timing" on melds;

create policy "melds visible to owner, or once the lay-off round begins" on melds
for select
using (
  exists (
    select 1 from players p
    where p.id = melds.owner_player_id and p.user_id = auth.uid()
  )
  or exists (
    select 1 from hands h
    where h.id = melds.hand_id
      and private.is_room_member(h.room_id)
      and h.phase in ('layoff', 'scoring', 'complete')
  )
);

drop policy "meld cards visible to owner, or per pay-me reveal timing" on meld_cards;

create policy "meld cards visible to owner, or once the lay-off round begins" on meld_cards
for select
using (
  exists (
    select 1 from melds m
    join players p on p.id = m.owner_player_id
    where m.id = meld_cards.meld_id and p.user_id = auth.uid()
  )
  or exists (
    select 1 from melds m
    join hands h on h.id = m.hand_id
    where m.id = meld_cards.meld_id
      and private.is_room_member(h.room_id)
      and h.phase in ('layoff', 'scoring', 'complete')
  )
);
