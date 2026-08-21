insert into public.marketplaces (slug, name, active)
values
  ('mercado-livre', 'Mercado Livre', true),
  ('shopee', 'Shopee', true),
  ('amazon', 'Amazon', false)
on conflict (slug) do update
set name = excluded.name,
    active = excluded.active;
