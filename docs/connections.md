# Conexões de marketplaces

A aba **Conexões** persiste as integrações na tabela `marketplace_connections` do Supabase.

## Shopee

- Tipo: `affiliate_api`
- Identificador: App ID
- Secret: criptografado com AES-256-GCM
- Status `connected` somente após validar a Affiliate Open API

## Mercado Livre

- Tipo: `oauth_app`
- Identificador: Client ID / APP ID
- Client Secret: criptografado com AES-256-GCM
- Redirect URI e configuração PKCE: armazenados em `metadata`
- Status inicial `pending` até a autorização OAuth da conta

Nenhum Secret é retornado pelas rotas GET da interface.
