create index if not exists generated_messages_user_id_idx
  on public.generated_messages(user_id);

create index if not exists offers_niche_id_idx
  on public.offers(niche_id);

create index if not exists products_marketplace_id_idx
  on public.products(marketplace_id);

create index if not exists search_runs_marketplace_id_idx
  on public.search_runs(marketplace_id);

create index if not exists search_runs_niche_id_idx
  on public.search_runs(niche_id);
