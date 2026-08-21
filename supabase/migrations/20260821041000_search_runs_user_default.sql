alter table public.search_runs
  alter column user_id set default auth.uid();
