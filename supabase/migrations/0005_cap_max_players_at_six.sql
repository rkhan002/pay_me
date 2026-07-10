-- Two-deck limit: rooms are capped at 6 players (see decksForPlayerCount).
-- Every existing room defaulted to max_players = 8 (none seats more than 2),
-- so clamp them down before tightening the check constraint.
update public.rooms set max_players = 6 where max_players > 6;

alter table public.rooms drop constraint rooms_max_players_check;
alter table public.rooms
  add constraint rooms_max_players_check check (max_players between 2 and 6);
alter table public.rooms alter column max_players set default 6;
