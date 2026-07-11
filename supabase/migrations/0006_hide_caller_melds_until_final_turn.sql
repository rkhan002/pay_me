-- The Pay Me caller's melds are hidden from each other player until that
-- player has taken their own final turn (they leave hands.pending_final_turns)
-- or the final-turns sequence is over entirely (phase is layoff/scoring/
-- complete). Non-caller melds are unchanged: revealed to everyone once the
-- hand leaves "playing". Everyone still sees WHO called Pay Me; only the
-- caller's melds are time-gated per viewer.

drop policy "melds visible to owner, or to everyone after reveal" on melds;

create policy "melds visible to owner, or per pay-me reveal timing" on melds
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
      and (
        (melds.owner_player_id is distinct from h.pay_me_caller_id and h.phase <> 'playing')
        or (
          melds.owner_player_id = h.pay_me_caller_id
          and (
            h.phase in ('layoff', 'scoring', 'complete')
            or (
              h.phase = 'final_turns'
              and not exists (
                select 1 from players vp
                where vp.room_id = h.room_id
                  and vp.user_id = auth.uid()
                  and vp.id = any (h.pending_final_turns)
              )
            )
          )
        )
      )
  )
);

drop policy "meld cards visible to owner, or to everyone after reveal" on meld_cards;

create policy "meld cards visible to owner, or per pay-me reveal timing" on meld_cards
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
      and (
        (m.owner_player_id is distinct from h.pay_me_caller_id and h.phase <> 'playing')
        or (
          m.owner_player_id = h.pay_me_caller_id
          and (
            h.phase in ('layoff', 'scoring', 'complete')
            or (
              h.phase = 'final_turns'
              and not exists (
                select 1 from players vp
                where vp.room_id = h.room_id
                  and vp.user_id = auth.uid()
                  and vp.id = any (h.pending_final_turns)
              )
            )
          )
        )
      )
  )
);
