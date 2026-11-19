-- After 001 + 002. Preserves existing app rows/UUIDs; does NOT link by email.
-- Back up first. Use the issuer for this Supabase project in the helper below.
begin;
create table if not exists public.dobao_accounts (
  id uuid primary key default gen_random_uuid(),
  firebase_project text,
  firebase_uid text,
  legacy_auth_user_id uuid unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(firebase_project,firebase_uid),
  check ((firebase_project is null and firebase_uid is null and legacy_auth_user_id is not null)
      or (firebase_project is not null and firebase_uid is not null and char_length(firebase_project) between 6 and 63 and char_length(firebase_uid) between 1 and 128 and legacy_auth_user_id is null))
);
alter table public.dobao_accounts enable row level security;
revoke all on public.dobao_accounts from public,anon,authenticated;
grant all on public.dobao_accounts to service_role;

-- Preserve legacy owners with existing app rows. No migration deletes health data.
insert into public.dobao_accounts(id,legacy_auth_user_id)
select owners.user_id,users.id from (
  select user_id from public.dobao_profiles union
  select user_id from public.dobao_consent_events union
  select user_id from public.dobao_daily union
  select user_id from public.dobao_health_projection union
  select user_id from public.dobao_rate_limits
) owners join auth.users users on users.id=owners.user_id on conflict(id) do nothing;
do $$
declare t text;
begin
  foreach t in array array['dobao_profiles','dobao_consent_events','dobao_daily','dobao_health_projection','dobao_rate_limits'] loop
    execute format('alter table public.%I drop constraint if exists %I',t,t||'_user_id_fkey');
    execute format('alter table public.%I add constraint %I foreign key(user_id) references public.dobao_accounts(id) on delete cascade',t,t||'_user_id_fkey');
  end loop;
end $$;

-- Called only after Firebase Admin verifies this project's Google ID token.
create or replace function public.dobao_register_firebase(p_project text,p_uid text)
returns uuid language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
  if p_project is null or p_project <> 'dobao-muge100' or p_uid is null or char_length(p_uid) not between 1 and 128 then raise exception 'invalid firebase identity'; end if;
  insert into public.dobao_accounts(firebase_project,firebase_uid) values(p_project,p_uid)
  on conflict(firebase_project,firebase_uid) do nothing;
  select id into owner_id from public.dobao_accounts where firebase_project=p_project and firebase_uid=p_uid;
  return owner_id;
end $$;
revoke all on function public.dobao_register_firebase(text,text) from public,anon,authenticated;
grant execute on function public.dobao_register_firebase(text,text) to service_role;

-- JWT is verified by Supabase's native Firebase Third-party Auth integration.
-- auth.uid() casts to UUID and cannot be used directly for Firebase's string UID.
create or replace function public.dobao_current_user_id()
returns uuid language plpgsql stable security definer set search_path='' as $$
declare claims jsonb := auth.jwt(); owner_id uuid;
begin
  if claims->>'iss'='https://securetoken.google.com/dobao-muge100'
    and claims->>'aud'='dobao-muge100' and claims->>'role'='authenticated'
    and claims->>'email_verified'='true'
    and claims->'firebase'->>'sign_in_provider'='google.com' then
    select id into owner_id from public.dobao_accounts
      where firebase_project='dobao-muge100' and firebase_uid=claims->>'sub';
    return owner_id;
  end if;
  -- Legacy Supabase owners remain separate; no automatic email-based account merge.
  if claims->>'iss'='https://sfybvpjalptxvzctigjz.supabase.co/auth/v1'
    and claims->>'sub' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into owner_id from public.dobao_accounts where legacy_auth_user_id=(claims->>'sub')::uuid;
    return owner_id;
  end if;
  return null;
end $$;
revoke all on function public.dobao_current_user_id() from public,anon,authenticated;
grant execute on function public.dobao_current_user_id() to authenticated;

drop policy if exists profile_select on public.dobao_profiles;
drop policy if exists profile_insert on public.dobao_profiles;
drop policy if exists profile_update on public.dobao_profiles;
drop policy if exists consent_select on public.dobao_consent_events;
drop policy if exists daily_select on public.dobao_daily;
drop policy if exists projection_select on public.dobao_health_projection;
create policy profile_select on public.dobao_profiles for select to authenticated using ((select public.dobao_current_user_id())=user_id);
create policy profile_insert on public.dobao_profiles for insert to authenticated with check ((select public.dobao_current_user_id())=user_id);
create policy profile_update on public.dobao_profiles for update to authenticated using ((select public.dobao_current_user_id())=user_id) with check ((select public.dobao_current_user_id())=user_id);
create policy consent_select on public.dobao_consent_events for select to authenticated using ((select public.dobao_current_user_id())=user_id);
create policy daily_select on public.dobao_daily for select to authenticated using ((select public.dobao_current_user_id())=user_id);
create policy projection_select on public.dobao_health_projection for select to authenticated using ((select public.dobao_current_user_id())=user_id);

create or replace function public.dobao_set_consent(p_version text,p_health boolean,p_ai boolean)
returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid := public.dobao_current_user_id();
begin
  if owner_id is null or p_version is distinct from '2026-10-13' or p_health is null or p_ai is null or (p_ai and not p_health) then raise exception 'invalid consent'; end if;
  insert into public.dobao_consent_events(user_id,notice_version,health,ai) values(owner_id,p_version,p_health,p_ai);
end $$;

create or replace function public.dobao_save_daily(p_day date,p_water integer,p_goals jsonb,p_revision integer)
returns setof public.dobao_daily language plpgsql security definer set search_path='' as $$
declare owner_id uuid := public.dobao_current_user_id(); changed public.dobao_daily;
begin
  if owner_id is null or not coalesce((select health and notice_version='2026-10-13' from public.dobao_consent_events where user_id=owner_id order by id desc limit 1),false) then raise exception 'consent required'; end if;
  if p_revision is null or p_revision<0 or p_water is null or p_goals is null or jsonb_typeof(p_goals)<>'array' then raise exception 'invalid daily payload'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_goals) g
    where jsonb_typeof(g)<>'object'
       or jsonb_typeof(g->'id') is distinct from 'string'
       or char_length(g->>'id') not between 1 and 50
       or jsonb_typeof(g->'label') is distinct from 'string'
       or char_length(btrim(g->>'label')) not between 1 and 120
       or jsonb_typeof(g->'done') is distinct from 'boolean'
  ) or (select count(*)<>count(distinct g->>'id') from jsonb_array_elements(p_goals) g)
  then raise exception 'invalid goals'; end if;
  if p_day is null or p_day < (now() at time zone 'Asia/Bangkok')::date-3650 or p_day > (now() at time zone 'Asia/Bangkok')::date+1 then raise exception 'invalid date'; end if;
  if p_revision=0 then
    insert into public.dobao_daily(user_id,day,water,goals) values(owner_id,p_day,p_water,p_goals) on conflict do nothing returning * into changed;
  else
    update public.dobao_daily set water=p_water,goals=p_goals,revision=revision+1,updated_at=now() where user_id=owner_id and day=p_day and revision=p_revision returning * into changed;
  end if;
  if changed.user_id is null then raise exception 'stale_revision'; end if;
  return next changed;
end $$;

create or replace function public.dobao_take_rate(p_bucket text)
returns boolean language plpgsql security definer set search_path='' as $$
declare owner_id uuid := public.dobao_current_user_id(); n integer; lim integer;
begin
  if owner_id is null or p_bucket is null or p_bucket not in ('ai','write','read') then return false; end if;
  lim:=case when p_bucket='ai' then 8 when p_bucket='write' then 40 else 100 end;
  insert into public.dobao_rate_limits(user_id,bucket,window_start,hits) values(owner_id,p_bucket,now(),1)
  on conflict(user_id,bucket) do update set hits=case when public.dobao_rate_limits.window_start < now()-interval '1 minute' then 1 else public.dobao_rate_limits.hits+1 end,window_start=case when public.dobao_rate_limits.window_start < now()-interval '1 minute' then now() else public.dobao_rate_limits.window_start end
  returning hits into n; return n<=lim;
end $$;
revoke all on function public.dobao_set_consent(text,boolean,boolean),public.dobao_save_daily(date,integer,jsonb,integer),public.dobao_take_rate(text) from public,anon,authenticated;
grant execute on function public.dobao_set_consent(text,boolean,boolean),public.dobao_save_daily(date,integer,jsonb,integer),public.dobao_take_rate(text) to authenticated;
commit;
notify pgrst,'reload schema';
