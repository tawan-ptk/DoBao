-- Profile identity, a small private avatar, and user-created shortcuts.
-- Existing owner RLS policies from 003 apply to all new columns.
begin;
alter table public.dobao_profiles
  add column if not exists first_name text not null default '' check (char_length(first_name)<=80),
  add column if not exists last_name text not null default '' check (char_length(last_name)<=80),
  add column if not exists theme text not null default 'mint' check(theme in ('mint','lavender','peach')),
  add column if not exists avatar_data_url text check(avatar_data_url is null or (char_length(avatar_data_url)<=90000 and avatar_data_url ~ '^data:image/webp;base64,[A-Za-z0-9+/=]+$')),
  add column if not exists shortcuts jsonb not null default '{"food":[],"activity":[]}' check(jsonb_typeof(shortcuts)='object' and octet_length(shortcuts::text)<=16000),
  add column if not exists revision integer not null default 1 check(revision>=1);
comment on column public.dobao_profiles.avatar_data_url is 'Private 256px WebP thumbnail; API decodes/re-encodes and strips image metadata. Never a public image URL.';
commit;
notify pgrst,'reload schema';
