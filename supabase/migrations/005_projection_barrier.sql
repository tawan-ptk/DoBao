-- Repair for projects that already ran the first version of 004.
-- No health rows are deleted by installing this function.
begin;
create or replace function public.dobao_finish_cleanup(p_user uuid,p_draft text,p_key uuid)
returns void language plpgsql security definer set search_path='' as $$
declare job public.dobao_cleanup_jobs;
begin
  select * into job from public.dobao_cleanup_jobs where user_id=p_user and draft_id=p_draft for update;
  if not found or job.request_key is distinct from p_key or job.phase not in ('cleanup','complete') then raise exception 'cleanup_not_confirmed'; end if;
  if job.phase='complete' then return; end if;
  if job.scope='all' then delete from public.dobao_daily where user_id=p_user and updated_at<=job.requested_at; end if;
  -- Empty tombstone contains no health payload but preserves the revision floor.
  -- dobao_project's existing ON CONFLICT condition rejects older snapshots.
  insert into public.dobao_health_projection(user_id,revision,records,summary,plans,synced_at)
  values(p_user,coalesce((job.source_result->>'revision')::bigint,job.source_revision),'[]','{}','[]',now())
  on conflict(user_id) do update set
    revision=greatest(public.dobao_health_projection.revision,excluded.revision),
    records='[]',summary='{}',plans='[]',synced_at=now();
  update public.dobao_cleanup_jobs set phase='complete',updated_at=now() where user_id=p_user and draft_id=p_draft;
end $$;
revoke all on function public.dobao_finish_cleanup(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.dobao_finish_cleanup(uuid,text,uuid) to service_role;
commit;
notify pgrst,'reload schema';
