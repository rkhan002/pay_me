-- Auto-close games that have gone a full week without any action.
-- "Action" = the most recent move in any of the room's hands; falling back to
-- the newest hand, then the room's own creation time for rooms that never got
-- past the lobby. A stale room is flipped to 'complete' (the existing terminal
-- status), which the client already treats as "don't reconnect / game over" -
-- so no client change is needed. Replaces the manual player-skip mechanism.

create extension if not exists pg_cron;

create or replace function public.close_inactive_rooms()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  with stale as (
    select r.id
    from rooms r
    where r.status <> 'complete'
      and coalesce(
        (select max(m.created_at)
           from moves m
           join hands h on h.id = m.hand_id
          where h.room_id = r.id),
        (select max(h.created_at) from hands h where h.room_id = r.id),
        r.created_at
      ) < now() - interval '7 days'
  )
  update rooms
     set status = 'complete'
   where id in (select id from stale);
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Run once a day (03:00 UTC). cron.schedule upserts by job name, so re-running
-- this migration just reschedules the same job rather than duplicating it.
select cron.schedule(
  'close-inactive-rooms',
  '0 3 * * *',
  $$select public.close_inactive_rooms();$$
);
