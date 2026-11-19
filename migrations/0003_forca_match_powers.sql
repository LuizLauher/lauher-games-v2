alter table forca_rooms
  add column if not exists match_over boolean not null default false,
  add column if not exists hint_used boolean not null default false,
  add column if not exists notice_id integer,
  add column if not exists notice_kind text,
  add column if not exists notice_message text,
  add column if not exists winner_id text;
