-- Optional character-icon id (e.g. 'av1') a player picks in the lobby; the
-- client resolves it to an image asset. Null = fall back to the initials circle.
alter table players add column avatar text check (avatar is null or length(avatar) <= 32);
