-- Private in-app contact requests. No health data is copied into this table.
begin;
create table if not exists public.dobao_support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.dobao_accounts(id) on delete cascade,
  topic text not null check(char_length(topic) between 1 and 120),
  message text not null check(char_length(message) between 1 and 2000),
  status text not null default 'new' check(status in ('new','answered','closed')),
  reply text check(reply is null or char_length(reply)<=4000),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create index if not exists dobao_support_owner_date on public.dobao_support_requests(user_id,created_at desc);
alter table public.dobao_support_requests enable row level security;
drop policy if exists support_read_own on public.dobao_support_requests;
drop policy if exists support_insert_own on public.dobao_support_requests;
drop policy if exists support_delete_own on public.dobao_support_requests;
create policy support_read_own on public.dobao_support_requests for select to authenticated using(user_id=public.dobao_current_user_id());
create policy support_insert_own on public.dobao_support_requests for insert to authenticated with check(user_id=public.dobao_current_user_id());
create policy support_delete_own on public.dobao_support_requests for delete to authenticated using(user_id=public.dobao_current_user_id());
revoke all on public.dobao_support_requests from public,anon,authenticated;
grant select,delete on public.dobao_support_requests to authenticated;
-- Users cannot forge a team reply, status, timestamps or another owner's UUID.
grant insert(user_id,topic,message) on public.dobao_support_requests to authenticated;
grant all on public.dobao_support_requests to service_role;
commit;
notify pgrst,'reload schema';
