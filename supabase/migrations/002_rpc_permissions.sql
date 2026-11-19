-- Run after 001. Safe to rerun; changes only DoBao function grants.
-- Supabase may grant anon/authenticated EXECUTE via default privileges.
-- Revoking PUBLIC alone does not remove those explicit grants.
begin;
revoke all on function
  public.dobao_set_consent(text,boolean,boolean),
  public.dobao_save_daily(date,integer,jsonb,integer),
  public.dobao_take_rate(text),
  public.dobao_acquire_lease(text,uuid),
  public.dobao_release_lease(text,uuid),
  public.dobao_project(uuid,bigint,jsonb,jsonb,jsonb)
from public,anon,authenticated;

grant execute on function
  public.dobao_set_consent(text,boolean,boolean),
  public.dobao_save_daily(date,integer,jsonb,integer),
  public.dobao_take_rate(text)
to authenticated;

grant execute on function
  public.dobao_acquire_lease(text,uuid),
  public.dobao_release_lease(text,uuid),
  public.dobao_project(uuid,bigint,jsonb,jsonb,jsonb)
to service_role;

-- Fail the migration rather than silently leave inherited grants open.
do $$
declare fn regprocedure;
begin
  foreach fn in array array[
    'public.dobao_acquire_lease(text,uuid)'::regprocedure,
    'public.dobao_release_lease(text,uuid)'::regprocedure,
    'public.dobao_project(uuid,bigint,jsonb,jsonb,jsonb)'::regprocedure
  ] loop
    if has_function_privilege('anon',fn,'EXECUTE') or has_function_privilege('authenticated',fn,'EXECUTE') then
      raise exception 'DoBao server-only RPC permissions are still open';
    end if;
  end loop;
  foreach fn in array array[
    'public.dobao_set_consent(text,boolean,boolean)'::regprocedure,
    'public.dobao_save_daily(date,integer,jsonb,integer)'::regprocedure,
    'public.dobao_take_rate(text)'::regprocedure
  ] loop
    if has_function_privilege('anon',fn,'EXECUTE') or not has_function_privilege('authenticated',fn,'EXECUTE') then
      raise exception 'DoBao user RPC permissions are incorrect';
    end if;
  end loop;
end $$;
commit;
notify pgrst,'reload schema';
