alter table forca_players
  add column if not exists streak integer not null default 0
  check (streak >= 0);
