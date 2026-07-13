-- Quick Mode (8 hands, wild 3-10) vs Full Game (11 hands, wild 3-K). The only
-- difference is where the game ends, stored here as a per-room hand count.
alter table rooms
  add column total_hands int not null default 11 check (total_hands between 1 and 11);

-- Mark the room complete the moment its final hand finishes. This keeps the
-- flow functions (pass-layoff / skip-stale-player / start-hand) mode-agnostic:
-- they don't need to know 8 vs 11 - the trigger ends the game at the right
-- hand for whichever mode the room was created with. Fires only on the
-- phase -> complete transition of a hand.
create or replace function mark_room_complete_on_final_hand()
returns trigger
language plpgsql
as $$
begin
  if new.phase = 'complete'
     and old.phase is distinct from 'complete'
     and new.hand_number >= (select total_hands from rooms where id = new.room_id) then
    update rooms set status = 'complete'
      where id = new.room_id and status <> 'complete';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mark_room_complete on hands;
create trigger trg_mark_room_complete
  after update of phase on hands
  for each row
  execute function mark_room_complete_on_final_hand();
