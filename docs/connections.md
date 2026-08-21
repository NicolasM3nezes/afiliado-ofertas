# Conexões de marketplaces

A aba **Conexões** persiste as integrações na tabela `marketplace_connections` do Supabase. Cada usuário só acessa as próprias conexões por RLS.

## Shopee

- Tipo: `affiliate_api`
- Identificador: App ID
- Secret: criptografado com AES-256-GCM
- Status `connected` somente após validar a Affiliate Open API
- Produtos, taxa de comissão e link afiliado vêm da Affiliate API

## Mercado Livre

- Tipo: `oauth_app`
- Identificador: Client ID / APP ID
- Client Secret: criptografado com AES-256-GCM
- Redirect URI e PKCE: armazenados em `metadata`
- Access token e refresh token: criptografados em colunas próprias
- Status inicial `pending` até a autorização OAuth
- Refresh token é rotacionado e salvo automaticamente quando o access token vence

### Programa de Afiliados

O OAuth de desenvolvedores e o Programa de Afiliados são integrações diferentes. O rastreamento de afiliado é configurado a partir de um link completo gerado na Central de Afiliados e salvo em `metadata.affiliate_tracking`.

A comissão apresentada no Mercado Livre é uma estimativa de referência e não deve ser tratada como pagamento garantido.

## Segurança

Nenhum Secret, access token ou refresh token é retornado pelas rotas GET da interface.

`APP_ENCRYPTION_KEY` deve permanecer fora do Git. Durante rotação, `APP_ENCRYPTION_KEY_PREVIOUS` permite ler dados antigos temporariamente; depois da regravação das credenciais, a chave anterior deve ser removida.
