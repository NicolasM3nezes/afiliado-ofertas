# Afiliado Ofertas

SaaS para pesquisar produtos em múltiplos marketplaces, ranquear oportunidades de afiliado e preparar mensagens para divulgação manual no WhatsApp.

## Estado atual

- Next.js 16 + React 19.
- Supabase Auth com separação por usuário via RLS.
- Shopee Affiliate Open API com App ID/Secret criptografados no banco.
- Mercado Livre com OAuth 2.0 Authorization Code + PKCE, access token e refresh token criptografados.
- Busca geral Shopee + Mercado Livre com filtro por plataforma.
- Ranking por relevância, qualidade, vendas, desconto e potencial de comissão.
- Links de afiliado Shopee vindos da Affiliate API.
- Rastreamento Mercado Livre configurável pela Central de Afiliados.
- Comissão estimada exibida por produto.
- Robô 2 para editar/salvar mensagem, copiar e abrir o WhatsApp sem disparo automático.
- Histórico automático de pesquisas em `/history`.
- Endpoint de saúde em `/api/health`.

## Rodar localmente

Requisitos:

- Node.js 22+
- npm
- Acesso ao projeto Supabase

No Windows, a forma recomendada é executar:

```powershell
.\INICIAR_LOCAL.bat
```

O script:

1. valida Node/npm;
2. preserva a chave de criptografia já existente;
3. gera uma chave local forte se necessário;
4. mantém `.env.local.backup` somente como backup local ignorado pelo Git;
5. executa `npm ci`;
6. executa a verificação de segurança do repositório;
7. inicia `npm run dev`.

Também é possível preparar `.env.local` manualmente a partir de `.env.example`.

## Variáveis de ambiente

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
APP_ENCRYPTION_KEY=
APP_ENCRYPTION_KEY_PREVIOUS=
```

`APP_ENCRYPTION_KEY` é segredo de servidor e deve ser estável entre ambiente local e Vercel quando os dois usam o mesmo banco. Nunca versione essa chave.

`APP_ENCRYPTION_KEY_PREVIOUS` deve ser usada somente durante uma rotação de chave e removida depois que as credenciais antigas forem regravadas.

## Conexões

### Shopee

A configuração é feita em **Conexões** usando o App ID e Secret da Affiliate Open API. O Secret é validado antes de ser salvo e nunca retorna para o navegador depois da gravação.

### Mercado Livre

A aplicação usa OAuth com Authorization Code + PKCE. Client Secret, access token e refresh token ficam criptografados no Supabase. A Redirect URI deve usar HTTPS e ter a mesma origem do painel durante o fluxo OAuth.

A busca do Mercado Livre usa o catálogo oficial e publicações associadas; o sistema não depende do antigo token estático `MERCADO_LIVRE_ACCESS_TOKEN`.

## Histórico e observabilidade

Cada pesquisa feita pelo radar registra um `search_run` por plataforma consultada com:

- palavra-chave;
- total de resultados;
- status concluído/falhou;
- duração;
- timeout;
- diagnóstico da fonte.

A página `/history` mostra essas pesquisas e também as ofertas/mensagens salvas pelo Robô 2.

## Segurança

Antes do build, o CI executa:

```bash
npm run check:security
```

A verificação bloqueia arquivos de ambiente versionados e padrões de segredos conhecidos. O projeto também envia headers HTTP de proteção contra framing, MIME sniffing e permissões desnecessárias.

Se uma chave já tiver sido publicada em Git, apagar o arquivo não remove o segredo do histórico: a credencial precisa ser rotacionada.

## Validação

Para validar localmente:

```bash
npm run check
```

Esse comando executa a verificação de segurança e o build de produção.

## Banco

As migrações estão em `supabase/migrations/`. Todas as tabelas de dados por usuário usam RLS e políticas baseadas em `auth.uid()`.
