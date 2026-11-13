# Curadoria de produto (shopify-curator)

Escolhe 1 produto por dia na Shopify da Florela. Não usa IA: é um placar simples e barato.

1. Busca os produtos ativos com estoque maior que zero e pelo menos uma foto.
2. Pontua cada produto:
   - Lançamento (criado há menos de `new_product_days`): `weight_new` pontos.
   - Estoque parado (acima de `overstock_threshold`): `weight_overstock` pontos.
   - Últimas unidades (abaixo de `low_stock_threshold`): `weight_low_stock` pontos.
3. Remove produtos usados nos últimos `min_days_between_repeats` dias.
4. Escolhe o maior placar. Empate: o mais recente.
5. Monta o link com UTM: `utm_source`, `utm_medium`, `utm_campaign=criativo-diario`, `utm_content=<id do criativo>`.

Para mudar a estratégia, edite os números em `config.yaml`. Pelo bot de comando você pode pedir
"gera um criativo do produto X" para pular a curadoria.
