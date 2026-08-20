create table if not exists public.marketplaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.niches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null,
  keywords text[] not null default '{}',
  excluded_keywords text[] not null default '{}',
  min_discount smallint not null default 15 check (min_discount between 0 and 100),
  min_score smallint not null default 60 check (min_score between 0 and 100),
  price_min numeric(12,2) check (price_min is null or price_min >= 0),
  price_max numeric(12,2) check (price_max is null or price_max >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug),
  check (price_min is null or price_max is null or price_min <= price_max)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  marketplace_id uuid not null references public.marketplaces(id) on delete restrict,
  external_id text not null,
  title text not null,
  permalink text not null,
  thumbnail_url text,
  category_external_id text,
  seller_name text,
  rating numeric(3,2) check (rating is null or rating between 0 and 5),
  sold_quantity integer check (sold_quantity is null or sold_quantity >= 0),
  raw jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, marketplace_id, external_id)
);

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  niche_id uuid references public.niches(id) on delete set null,
  current_price numeric(12,2) not null check (current_price >= 0),
  original_price numeric(12,2) check (original_price is null or original_price >= 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  coupon_code text,
  coupon_text text,
  shipping_free boolean not null default false,
  score numeric(5,2) not null default 0 check (score between 0 and 100),
  status text not null default 'new' check (status in ('new','prepared','used','ignored','expired')),
  affiliate_url text,
  found_at timestamptz not null default now(),
  expires_at timestamptz,
  used_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.generated_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  offer_id uuid not null references public.offers(id) on delete cascade,
  template_key text not null default 'default',
  message_text text not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.search_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  marketplace_id uuid not null references public.marketplaces(id) on delete restrict,
  niche_id uuid references public.niches(id) on delete set null,
  query text not null,
  filters jsonb not null default '{}'::jsonb,
  total_found integer not null default 0 check (total_found >= 0),
  status text not null default 'running' check (status in ('running','completed','failed')),
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  default_marketplace_slug text not null default 'mercado-livre',
  default_min_discount smallint not null default 15 check (default_min_discount between 0 and 100),
  default_min_score smallint not null default 60 check (default_min_score between 0 and 100),
  message_template text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists niches_user_id_idx on public.niches(user_id);
create index if not exists products_user_marketplace_idx on public.products(user_id, marketplace_id);
create index if not exists products_last_seen_idx on public.products(last_seen_at desc);
create index if not exists offers_user_status_score_idx on public.offers(user_id, status, score desc);
create index if not exists offers_product_idx on public.offers(product_id);
create index if not exists offers_found_at_idx on public.offers(found_at desc);
create index if not exists generated_messages_offer_idx on public.generated_messages(offer_id, created_at desc);
create index if not exists search_runs_user_started_idx on public.search_runs(user_id, started_at desc);

alter table public.marketplaces enable row level security;
alter table public.niches enable row level security;
alter table public.products enable row level security;
alter table public.offers enable row level security;
alter table public.generated_messages enable row level security;
alter table public.search_runs enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists "authenticated can read marketplaces" on public.marketplaces;
create policy "authenticated can read marketplaces" on public.marketplaces for select to authenticated using (true);

drop policy if exists "users manage own niches" on public.niches;
create policy "users manage own niches" on public.niches for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "users manage own products" on public.products;
create policy "users manage own products" on public.products for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "users manage own offers" on public.offers;
create policy "users manage own offers" on public.offers for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "users manage own generated messages" on public.generated_messages;
create policy "users manage own generated messages" on public.generated_messages for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "users manage own search runs" on public.search_runs;
create policy "users manage own search runs" on public.search_runs for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "users manage own app settings" on public.app_settings;
create policy "users manage own app settings" on public.app_settings for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

revoke all on public.marketplaces from anon;
revoke all on public.niches from anon;
revoke all on public.products from anon;
revoke all on public.offers from anon;
revoke all on public.generated_messages from anon;
revoke all on public.search_runs from anon;
revoke all on public.app_settings from anon;

grant select on public.marketplaces to authenticated;
grant select, insert, update, delete on public.niches to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select, insert, update, delete on public.offers to authenticated;
grant select, insert, update, delete on public.generated_messages to authenticated;
grant select, insert, update, delete on public.search_runs to authenticated;
grant select, insert, update, delete on public.app_settings to authenticated;

insert into public.marketplaces (slug, name, active)
values
  ('mercado-livre', 'Mercado Livre', true),
  ('shopee', 'Shopee', false),
  ('amazon', 'Amazon', false)
on conflict (slug) do update set name = excluded.name, active = excluded.active;
