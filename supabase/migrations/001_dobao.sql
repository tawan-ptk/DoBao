-- Run once in the Supabase SQL Editor of a staging project first.
-- Health records are a read-only projection of the AI service's confirmed data.
begin;
create table public.dobao_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  updated_at timestamptz not null default now()
);
create table public.dobao_consent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  notice_version text not null,
  health boolean not null,
  ai boolean not null check (not ai or health),
  accepted_at timestamptz not null default now()
);
create index on public.dobao_consent_events(user_id,id desc);
create table public.dobao_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  water integer not null default 0 check (water between 0 and 50),
  goals jsonb not null default '[]' check (jsonb_typeof(goals)='array' and jsonb_array_length(goals)<=20),
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id,day)
);
create table public.dobao_health_projection (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null,
  records jsonb not null default '[]',
  summary jsonb not null default '{}',
  plans jsonb not null default '[]',
  synced_at timestamptz not null default now()
);
create table public.dobao_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null,
  primary key(user_id,bucket)
);
create table public.dobao_leases (
  slot text primary key,
  lease_id uuid not null,
  expires_at timestamptz not null
);
alter table public.dobao_profiles enable row level security;
alter table public.dobao_consent_events enable row level security;
alter table public.dobao_daily enable row level security;
alter table public.dobao_health_projection enable row level security;
alter table public.dobao_rate_limits enable row level security;
alter table public.dobao_leases enable row level security;
revoke all on public.dobao_profiles,public.dobao_consent_events,public.dobao_daily,public.dobao_health_projection,public.dobao_rate_limits,public.dobao_leases from anon,authenticated;
grant all on public.dobao_profiles,public.dobao_consent_events,public.dobao_daily,public.dobao_health_projection,public.dobao_rate_limits,public.dobao_leases to service_role;
grant select,insert,update on public.dobao_profiles to authenticated;
grant select on public.dobao_consent_events,public.dobao_daily,public.dobao_health_projection to authenticated;
create policy profile_select on public.dobao_profiles for select to authenticated using ((select auth.uid())=user_id);
create policy profile_insert on public.dobao_profiles for insert to authenticated with check ((select auth.uid())=user_id);
create policy profile_update on public.dobao_profiles for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
create policy consent_select on public.dobao_consent_events for select to authenticated using ((select auth.uid())=user_id);
create policy daily_select on public.dobao_daily for select to authenticated using ((select auth.uid())=user_id);
create policy projection_select on public.dobao_health_projection for select to authenticated using ((select auth.uid())=user_id);

create function public.dobao_set_consent(p_version text,p_health boolean,p_ai boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or p_version <> '2026-10-13' or (p_ai and not p_health) then raise exception 'invalid consent'; end if;
  insert into public.dobao_consent_events(user_id,notice_version,health,ai) values(auth.uid(),p_version,p_health,p_ai);
end $$;
revoke all on function public.dobao_set_consent(text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.dobao_set_consent(text,boolean,boolean) to authenticated;

-- Compare-and-swap prevents two devices silently overwriting one another.
create function public.dobao_save_daily(p_day date,p_water integer,p_goals jsonb,p_revision integer)
returns setof public.dobao_daily language plpgsql security definer set search_path='' as $$
declare changed public.dobao_daily;
begin
  if auth.uid() is null or not coalesce((select health and notice_version='2026-10-13' from public.dobao_consent_events where user_id=auth.uid() order by id desc limit 1),false) then raise exception 'consent required'; end if;
  -- Validate in SQL as well: a browser can call a granted RPC directly.
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
  if p_day < (now() at time zone 'Asia/Bangkok')::date-3650 or p_day > (now() at time zone 'Asia/Bangkok')::date+1 then raise exception 'invalid date'; end if;
  if p_revision=0 then
    insert into public.dobao_daily(user_id,day,water,goals) values(auth.uid(),p_day,p_water,p_goals) on conflict do nothing returning * into changed;
  else
    update public.dobao_daily set water=p_water,goals=p_goals,revision=revision+1,updated_at=now() where user_id=auth.uid() and day=p_day and revision=p_revision returning * into changed;
  end if;
  if changed.user_id is null then raise exception 'stale_revision'; end if;
  return next changed;
end $$;
revoke all on function public.dobao_save_daily(date,integer,jsonb,integer) from public,anon,authenticated;
grant execute on function public.dobao_save_daily(date,integer,jsonb,integer) to authenticated;

create function public.dobao_take_rate(p_bucket text)
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer; lim integer;
begin
  if auth.uid() is null or p_bucket not in ('ai','write','read') then return false; end if;
  lim:=case when p_bucket='ai' then 8 when p_bucket='write' then 40 else 100 end;
  insert into public.dobao_rate_limits(user_id,bucket,window_start,hits) values(auth.uid(),p_bucket,now(),1)
  on conflict(user_id,bucket) do update set hits=case when public.dobao_rate_limits.window_start < now()-interval '1 minute' then 1 else public.dobao_rate_limits.hits+1 end,window_start=case when public.dobao_rate_limits.window_start < now()-interval '1 minute' then now() else public.dobao_rate_limits.window_start end
  returning hits into n;
  return n<=lim;
end $$;
revoke all on function public.dobao_take_rate(text) from public,anon,authenticated;
grant execute on function public.dobao_take_rate(text) to authenticated;

-- Durable model concurrency limit works across serverless instances.
create function public.dobao_acquire_lease(p_slot text,p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  insert into public.dobao_leases values(p_slot,p_id,now()+interval '235 seconds')
  on conflict(slot) do update set lease_id=p_id,expires_at=now()+interval '235 seconds' where public.dobao_leases.expires_at<now();
  get diagnostics n=row_count; return n=1;
end $$;
create function public.dobao_release_lease(p_slot text,p_id uuid)
returns void language sql security definer set search_path='' as $$ delete from public.dobao_leases where slot=p_slot and lease_id=p_id $$;
revoke all on function public.dobao_acquire_lease(text,uuid), public.dobao_release_lease(text,uuid) from public,anon,authenticated;
grant execute on function public.dobao_acquire_lease(text,uuid), public.dobao_release_lease(text,uuid) to service_role;

-- A slower request cannot overwrite a more recent projection.
create function public.dobao_project(p_user uuid,p_revision bigint,p_records jsonb,p_summary jsonb,p_plans jsonb)
returns void language sql security definer set search_path='' as $$
  insert into public.dobao_health_projection values(p_user,p_revision,p_records,p_summary,p_plans,now())
  on conflict(user_id) do update set revision=excluded.revision,records=excluded.records,summary=excluded.summary,plans=excluded.plans,synced_at=now()
  where public.dobao_health_projection.revision<=excluded.revision
$$;
revoke all on function public.dobao_project(uuid,bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.dobao_project(uuid,bigint,jsonb,jsonb,jsonb) to service_role;
commit;
