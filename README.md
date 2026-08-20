# Afiliado Ofertas

MVP para encontrar ofertas por nicho, ranquear oportunidades e preparar mensagens para envio manual no WhatsApp.

## Estado atual

- Supabase com RLS e separação por usuário.
- Login/cadastro por Supabase Auth.
- Cadastro de nichos e filtros de desconto/score.
- Conector Mercado Livre desacoplado por marketplace.
- Modo demo para validar o fluxo local enquanto o endpoint real de busca não estiver liberado.
- Robô 2 com mensagem pronta, edição, cópia e abertura do WhatsApp sem disparo automático.
- Histórico preparado no banco para ofertas, buscas e mensagens.

## Rodar localmente

Requisitos:

- Node.js 22+
- npm
- Projeto Supabase configurado

1. Clone o repositório.
2. Rode `npm install`.
3. Copie `.env.example` para `.env.local`.
4. Preencha `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
5. Mantenha `ALLOW_DEMO_OFFERS=true` no primeiro teste.
6. Rode `npm run dev`.
7. Abra `http://localhost:3000`.

O primeiro acesso pode exigir confirmação do e-mail, dependendo da configuração de Auth do Supabase.

## Mercado Livre

O conector real usa `MERCADO_LIVRE_ACCESS_TOKEN` somente no servidor. Nunca coloque esse token em variável `NEXT_PUBLIC_*`.

Em 2026, o endpoint tradicional `GET /sites/MLB/search` pode retornar 403 para aplicações sem liberação. Por isso o app não depende estruturalmente dele e consegue operar em modo demo enquanto outra fonte oficial/permitida é conectada.

## Link de afiliado

O gerador oficial do programa de Afiliados do Mercado Livre funciona na Central/Barra de Afiliados. Como não há uma API pública documentada de geração de link para este fluxo, o MVP permite colar o link de afiliado no modal de preparação da mensagem. O conector de link foi mantido desacoplado para futura automação por fonte oficial.

## Banco

A migração inicial está em `supabase/migrations/20260820185630_initial_affiliate_offers_schema.sql`.
