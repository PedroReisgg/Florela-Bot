import { config } from './config.js';

async function gql(query, variables = {}) {
  const { store, token, apiVersion } = config.shopify;
  if (!store || !token) throw new Error('Shopify não configurada (SHOPIFY_STORE_DOMAIN e SHOPIFY_ADMIN_TOKEN).');
  const res = await fetch(`https://${store}/admin/api/${apiVersion}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.errors) {
    throw new Error(`Shopify ${res.status}: ${JSON.stringify(body.errors ?? body).slice(0, 400)}`);
  }
  return body.data;
}

const PRODUCT_FIELDS = `
  id title handle description vendor productType tags createdAt totalInventory onlineStoreUrl
  priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
  compareAtPriceRange { minVariantCompareAtPrice { amount } }
  media(first: 6) { nodes { ... on MediaImage { image { url altText } } } }
`;

function normalize(p) {
  const images = (p.media?.nodes ?? []).map((m) => m.image).filter(Boolean);
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    description: (p.description ?? '').slice(0, 1500),
    vendor: p.vendor,
    productType: p.productType,
    tags: p.tags,
    createdAt: p.createdAt,
    inventory: p.totalInventory,
    price: p.priceRangeV2?.minVariantPrice?.amount,
    maxPrice: p.priceRangeV2?.maxVariantPrice?.amount,
    compareAtPrice: p.compareAtPriceRange?.minVariantCompareAtPrice?.amount ?? null,
    currency: p.priceRangeV2?.minVariantPrice?.currencyCode ?? 'BRL',
    url: p.onlineStoreUrl || `${config.shopify.publicUrl}/products/${p.handle}`,
    images: images.map((i) => i.url),
  };
}

export async function searchProducts(search = '', first = 50) {
  const q = ['status:active', search].filter(Boolean).join(' ');
  const data = await gql(`query($first: Int!, $q: String) { products(first: $first, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { ${PRODUCT_FIELDS} } } }`, {
    first,
    q,
  });
  return data.products.nodes.map(normalize);
}

export async function getProduct(id) {
  const data = await gql(`query($id: ID!) { product(id: $id) { ${PRODUCT_FIELDS} } }`, { id });
  return data.product ? normalize(data.product) : null;
}

export async function paidOrdersSince(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const data = await gql(
    `query($q: String) { orders(first: 100, query: $q, sortKey: CREATED_AT, reverse: true) { nodes {
      name createdAt
      totalPriceSet { shopMoney { amount currencyCode } }
      customerJourneySummary { lastVisit { landingPage utmParameters { source medium campaign content } } }
      lineItems(first: 10) { nodes { title quantity product { id } } }
    } } }`,
    { q: `created_at:>=${since} financial_status:paid` },
  );
  return data.orders.nodes.map((o) => ({
    name: o.name,
    createdAt: o.createdAt,
    total: Number(o.totalPriceSet.shopMoney.amount),
    utm: o.customerJourneySummary?.lastVisit?.utmParameters ?? null,
    landingPage: o.customerJourneySummary?.lastVisit?.landingPage ?? null,
    items: o.lineItems.nodes.map((li) => ({ title: li.title, quantity: li.quantity, productId: li.product?.id })),
  }));
}

export function utmUrl(product, runId, curatorCfg) {
  const url = new URL(product.url);
  url.searchParams.set('utm_source', curatorCfg.utm_source || 'instagram');
  url.searchParams.set('utm_medium', curatorCfg.utm_medium || 'organic');
  url.searchParams.set('utm_campaign', 'criativo-diario');
  url.searchParams.set('utm_content', runId);
  return url.toString();
}
