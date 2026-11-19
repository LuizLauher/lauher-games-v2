alter table forca_rooms
  add column if not exists eliminated_letters text not null default '';
