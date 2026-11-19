-- Durable metadata for user-confirmed deletion. No meal/medical text is stored here.
begin;
create table if not exists public.dobao_cleanup_jobs (
  user_id uuid not null references public.dobao_accounts(id) on delete cascade,
  draft_id text not null check(char_length(draft_id) between 1 and 200),
  scope text not null check(scope in ('records','all')),
  record_ids jsonb not null default '[]',
  counts jsonb not null default '{}',
  source_revision bigint not null,
  request_key uuid,
  phase text not null default 'preview' check(phase in ('preview','uncertain','cleanup','complete')),
  requested_at timestamptz,
  source_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,draft_id)
);
alter table public.dobao_cleanup_jobs enable row level security;
revoke all on public.dobao_cleanup_jobs from public,anon,authenticated;
grant all on public.dobao_cleanup_jobs to service_role;
grant select on public.dobao_cleanup_jobs to authenticated;
drop policy if exists cleanup_owner on public.dobao_cleanup_jobs;
create policy cleanup_owner on public.dobao_cleanup_jobs for select to authenticated
using ((select public.dobao_current_user_id())=user_id);

create or replace function public.dobao_begin_cleanup(p_user uuid,p_draft text,p_key uuid)
returns setof public.dobao_cleanup_jobs language plpgsql security definer set search_path='' as $$
declare job public.dobao_cleanup_jobs;
begin
  select * into job from public.dobao_cleanup_jobs where user_id=p_user and draft_id=p_draft for update;
  if not found then raise exception 'cleanup_not_found'; end if;
  if p_key is null or (job.request_key is not null and job.request_key<>p_key) then raise exception 'cleanup_key_conflict'; end if;
  if job.phase='preview' then
    update public.dobao_cleanup_jobs set phase='uncertain',request_key=p_key,requested_at=now(),updated_at=now()
    where user_id=p_user and draft_id=p_draft returning * into job;
  end if;
  return next job;
end $$;

-- Atomic Supabase cleanup. New edits made after the original request are preserved.
create or replace function public.dobao_finish_cleanup(p_user uuid,p_draft text,p_key uuid)
returns void language plpgsql security definer set search_path='' as $$
declare job public.dobao_cleanup_jobs;
begin
  select * into job from public.dobao_cleanup_jobs where user_id=p_user and draft_id=p_draft for update;
  if not found or job.request_key is distinct from p_key or job.phase not in ('cleanup','complete') then raise exception 'cleanup_not_confirmed'; end if;
  if job.phase='complete' then return; end if;
  if job.scope='all' then delete from public.dobao_daily where user_id=p_user and updated_at<=job.requested_at; end if;
  -- Keep only an EMPTY revision barrier. An older in-flight sync must not be
  -- able to recreate deleted health payloads after this transaction completes.
  insert into public.dobao_health_projection(user_id,revision,records,summary,plans,synced_at)
  values(p_user,coalesce((job.source_result->>'revision')::bigint,job.source_revision),'[]','{}','[]',now())
  on conflict(user_id) do update set
    revision=greatest(public.dobao_health_projection.revision,excluded.revision),
    records='[]',summary='{}',plans='[]',synced_at=now();
  update public.dobao_cleanup_jobs set phase='complete',updated_at=now() where user_id=p_user and draft_id=p_draft;
end $$;
revoke all on function public.dobao_begin_cleanup(uuid,text,uuid),public.dobao_finish_cleanup(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.dobao_begin_cleanup(uuid,text,uuid),public.dobao_finish_cleanup(uuid,text,uuid) to service_role;
commit;
notify pgrst,'reload schema';
