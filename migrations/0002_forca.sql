create table if not exists forca_rooms (
  code text primary key,
  host_id text not null,
  phase text not null default 'lobby',
  category text not null default '',
  secret_word text not null default '',
  wrong_letters text not null default '',
  guessed_letters text not null default '',
  result text,
  last_guesser_id text,
  word_chooser_id text,
  current_turn_id text,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists forca_players (
  id text primary key,
  room_code text not null references forca_rooms(code) on delete cascade,
  name text not null,
  score integer not null default 0,
  wins integer not null default 0,
  token_hash text not null,
  seat integer not null default 0,
  last_seen timestamptz not null default now()
);

create index if not exists forca_players_room_idx on forca_players (room_code);
create index if not exists forca_players_token_idx on forca_players (room_code, token_hash);
