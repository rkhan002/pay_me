-- The `connected` boolean was never actually written anywhere except on
-- join/rejoin, so it could only ever go true -> stays true forever, even
-- after a real disconnect. Replace it with a heartbeat timestamp: clients
-- ping periodically while the table is open, and "connected" becomes a
-- computed staleness check (now() - last_seen_at < threshold) instead of a
-- flag nobody ever flips back off.
alter table players
  drop column connected,
  add column last_seen_at timestamptz not null default now();
