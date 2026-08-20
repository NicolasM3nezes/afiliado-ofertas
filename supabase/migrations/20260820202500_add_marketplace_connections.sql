create table if not exists public.marketplace_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  marketplace_slug text not null,
  connection_type text not null default 'affiliate_api',
  display_name text,
  account_identifier text not null,
  encrypted_secret text not null,
  secret_iv text not null,
  secret_tag text not null,
  status text not null default 'pending' check (status in ('pending','connected','error','disabled')),
  last_tested_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, marketplace_slug, connection_type)
);

create index if not exists marketplace_connections_user_marketplace_idx
  on public.marketplace_connections(user_id, marketplace_slug);

alter table public.marketplace_connections enable row level security;

drop policy if exists "Users can view own marketplace connections" on public.marketplace_connections;
create policy "Users can view own marketplace connections"
on public.marketplace_connections for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own marketplace connections" on public.marketplace_connections;
create policy "Users can insert own marketplace connections"
on public.marketplace_connections for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own marketplace connections" on public.marketplace_connections;
create policy "Users can update own marketplace connections"
on public.marketplace_connections for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own marketplace connections" on public.marketplace_connections;
create policy "Users can delete own marketplace connections"
on public.marketplace_connections for delete
to authenticated
using ((select auth.uid()) = user_id);
