# Validação dos cards de conexão

Os cards Shopee e Mercado Livre usam a tabela `marketplace_connections` e não expõem Secrets nas respostas GET.

Este arquivo também força a validação CI do estado atual da `main` após a inclusão dos dois cards.
