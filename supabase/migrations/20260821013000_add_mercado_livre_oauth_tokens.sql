alter table public.marketplace_connections
  add column if not exists oauth_access_token_encrypted text,
  add column if not exists oauth_access_token_iv text,
  add column if not exists oauth_access_token_tag text,
  add column if not exists oauth_refresh_token_encrypted text,
  add column if not exists oauth_refresh_token_iv text,
  add column if not exists oauth_refresh_token_tag text,
  add column if not exists oauth_expires_at timestamptz,
  add column if not exists oauth_connected_at timestamptz;
