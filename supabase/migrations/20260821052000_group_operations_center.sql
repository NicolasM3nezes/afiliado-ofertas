create table if not exists public.offer_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  audience text,
  keywords text[] not null default '{}',
  excluded_keywords text[] not null default '{}',
  allowed_marketplaces text[] not null default array['shopee','mercado-livre'],
  price_min numeric(12,2) check (price_min is null or price_min >= 0),
  price_max numeric(12,2) check (price_max is null or price_max >= 0),
  min_score smallint not null default 55 check (min_score between 0 and 100),
  min_commission numeric(12,2) not null default 0 check (min_commission >= 0),
  daily_limit smallint not null default 10 check (daily_limit between 1 and 100),
  repeat_after_hours integer not null default 72 check (repeat_after_hours between 1 and 8760),
  message_template text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug),
  check (price_min is null or price_max is null or price_min <= price_max)
);

create table if not exists public.offer_group_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  group_id uuid not null references public.offer_groups(id) on delete cascade,
  marketplace_slug text not null check (marketplace_slug in ('shopee','mercado-livre','amazon')),
  external_id text not null,
  title text not null,
  permalink text,
  affiliate_url text,
  thumbnail_url text,
  seller_name text,
  price numeric(12,2) not null default 0 check (price >= 0),
  original_price numeric(12,2) check (original_price is null or original_price >= 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  score numeric(5,2) not null default 0 check (score between 0 and 100),
  estimated_commission numeric(12,2) not null default 0 check (estimated_commission >= 0),
  commission_rate numeric(7,3) not null default 0 check (commission_rate >= 0),
  rating numeric(4,2),
  sold_quantity integer not null default 0 check (sold_quantity >= 0),
  free_shipping boolean not null default false,
  message_text text,
  status text not null default 'queued' check (status in ('queued','prepared','published','skipped','expired')),
  priority smallint not null default 50 check (priority between 0 and 100),
  scheduled_for timestamptz,
  last_validated_at timestamptz,
  validation_status text not null default 'unchecked' check (validation_status in ('unchecked','valid','changed','unavailable','failed')),
  validation_note text,
  published_at timestamptz,
  clicks integer not null default 0 check (clicks >= 0),
  conversions integer not null default 0 check (conversions >= 0),
  actual_commission numeric(12,2) not null default 0 check (actual_commission >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists offer_group_queue_active_product_uidx
  on public.offer_group_queue(user_id, group_id, marketplace_slug, external_id)
  where status in ('queued','prepared');
create index if not exists offer_group_queue_group_status_idx
  on public.offer_group_queue(user_id, group_id, status, scheduled_for, priority desc);
create index if not exists offer_group_queue_published_idx
  on public.offer_group_queue(user_id, group_id, published_at desc)
  where status = 'published';

create table if not exists public.favorite_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  list_name text not null default 'Favoritos',
  marketplace_slug text not null check (marketplace_slug in ('shopee','mercado-livre','amazon')),
  external_id text not null,
  title text not null,
  permalink text,
  affiliate_url text,
  thumbnail_url text,
  seller_name text,
  price numeric(12,2) not null default 0 check (price >= 0),
  original_price numeric(12,2),
  discount_percent numeric(5,2) not null default 0,
  score numeric(5,2) not null default 0,
  estimated_commission numeric(12,2) not null default 0,
  commission_rate numeric(7,3) not null default 0,
  rating numeric(4,2),
  sold_quantity integer not null default 0,
  free_shipping boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, list_name, marketplace_slug, external_id)
);
create index if not exists favorite_offers_user_created_idx
  on public.favorite_offers(user_id, created_at desc);

create table if not exists public.offer_price_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  marketplace_slug text not null check (marketplace_slug in ('shopee','mercado-livre','amazon')),
  external_id text not null,
  title text,
  price numeric(12,2) not null check (price >= 0),
  original_price numeric(12,2),
  score numeric(5,2) not null default 0,
  captured_on date not null default current_date,
  captured_at timestamptz not null default now(),
  unique (user_id, marketplace_slug, external_id, captured_on)
);
create index if not exists offer_price_history_lookup_idx
  on public.offer_price_history(user_id, marketplace_slug, external_id, captured_at desc);

alter table public.offer_groups enable row level security;
alter table public.offer_group_queue enable row level security;
alter table public.favorite_offers enable row level security;
alter table public.offer_price_history enable row level security;

drop policy if exists "users manage own offer groups" on public.offer_groups;
create policy "users manage own offer groups" on public.offer_groups for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "users manage own offer group queue" on public.offer_group_queue;
create policy "users manage own offer group queue" on public.offer_group_queue for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "users manage own favorite offers" on public.favorite_offers;
create policy "users manage own favorite offers" on public.favorite_offers for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "users manage own offer price history" on public.offer_price_history;
create policy "users manage own offer price history" on public.offer_price_history for all to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.offer_groups from anon;
revoke all on public.offer_group_queue from anon;
revoke all on public.favorite_offers from anon;
revoke all on public.offer_price_history from anon;

grant select, insert, update, delete on public.offer_groups to authenticated;
grant select, insert, update, delete on public.offer_group_queue to authenticated;
grant select, insert, update, delete on public.favorite_offers to authenticated;
grant select, insert, update, delete on public.offer_price_history to authenticated;