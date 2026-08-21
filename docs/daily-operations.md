# Operação do Dia

A rota `/groups/today` concentra o fluxo operacional diário dos grupos de ofertas.

## Fluxo recomendado

1. Selecione o grupo.
2. Clique em **Atualizar oportunidades** para consultar até quatro palavras-chave salvas no perfil do grupo.
3. Clique em **Montar fila de hoje** para preencher somente as vagas restantes do limite diário.
4. O algoritmo diversifica a seleção entre campeão de vendas, comissão alta, achadinho, frete grátis e melhor oportunidade.
5. Em **Preparar 1 clique**, a oferta é revalidada na API, o preço é atualizado, a mensagem do grupo é reconstruída e copiada.
6. **Preparar + abrir WhatsApp** executa a mesma validação e abre o WhatsApp manualmente com a mensagem pronta.
7. Depois da publicação manual, use **Publicado + próxima**. O item é registrado como publicado e a próxima recomendação assume o topo.

## Regras respeitadas

- marketplaces permitidos no grupo;
- preço mínimo e máximo;
- score mínimo;
- comissão mínima;
- palavras proibidas;
- limite diário;
- anti-repetição;
- produtos que já estão em fila ativa.

## Atualizar todos os grupos

O botão executa os grupos sequencialmente para reduzir pressão nas APIs dos marketplaces. Grupos que já possuem publicações + fila ativa suficientes para o limite do dia são pulados.

## Segurança operacional

Nenhum botão dispara mensagem automaticamente no WhatsApp. A plataforma revalida, prepara, copia e abre o WhatsApp, mas a publicação continua sendo uma ação do usuário.
