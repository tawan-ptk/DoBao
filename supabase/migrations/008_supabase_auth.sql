-- After 001–007. Switches sign-in from Firebase to native Supabase Auth (Google).
-- Back up first. Preserves every existing row; does NOT link accounts by email.
--
-- Accounts created through Firebase stay in dobao_accounts but are no longer
-- reachable by a Firebase token. To give such an owner their old data, an
-- operator links it manually after verifying the person (see docs/SUPABASE_LOGIN.md).
-- Afterwards, remove Firebase from Authentication > Sign In / Providers >
-- Third-party Auth in the Supabase dashboard.
begin;

-- "legacy" no longer describes these rows: Supabase Auth is now the only sign-in.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='dobao_accounts' and column_name='legacy_auth_user_id') then
    alter table public.dobao_accounts rename column legacy_auth_user_id to auth_user_id;
  end if;
end $$;

-- Called only by the server after Supabase Auth verified a recent Google sign-in.
-- New owners use their auth.users UUID as the account ID.
create or replace function public.dobao_register_supabase(p_user uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
  if p_user is null or not exists (
    select 1 from auth.users where id=p_user and coalesce(is_anonymous,false)=false
  ) then raise exception 'invalid supabase identity'; end if;
  insert into public.dobao_accounts(id,auth_user_id) values(p_user,p_user)
  on conflict do nothing;
  select id into owner_id from public.dobao_accounts where auth_user_id=p_user;
  if owner_id is null then raise exception 'account id conflict'; end if;
  return owner_id;
end $$;
revoke all on function public.dobao_register_supabase(uuid) from public,anon,authenticated;
grant execute on function public.dobao_register_supabase(uuid) to service_role;

-- Every RLS policy and user RPC (001–007) resolves the owner through this one
-- function, so replacing it moves the whole app to Supabase Auth.
-- Accepts only this project's own Supabase Auth tokens (issuer ends in
-- /auth/v1, UUID subject); Firebase tokens (securetoken.google.com) are refused.
create or replace function public.dobao_current_user_id()
returns uuid language plpgsql stable security definer set search_path='' as $$
declare claims jsonb := auth.jwt(); owner_id uuid;
begin
  if claims->>'role'='authenticated'
    and claims->>'iss' like 'https://%/auth/v1'
    and claims->>'sub' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and coalesce(claims->>'is_anonymous','false')<>'true' then
    select id into owner_id from public.dobao_accounts where auth_user_id=(claims->>'sub')::uuid;
  end if;
  return owner_id;
end $$;
revoke all on function public.dobao_current_user_id() from public,anon,authenticated;
grant execute on function public.dobao_current_user_id() to authenticated;

-- Firebase registration is retired. Rows and columns stay for manual linking.
drop function if exists public.dobao_register_firebase(text,text);

do $$
begin
  if has_function_privilege('anon','public.dobao_register_supabase(uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.dobao_register_supabase(uuid)','EXECUTE') then
    raise exception 'DoBao server-only registration RPC is still open';
  end if;
end $$;
commit;
notify pgrst,'reload schema';
