import crypto from 'node:crypto';
import { loadSkill, loadContext } from './config.js';
import { createRun, updateRun, getRun, productUsedSince, getSetting } from './db.js';
import { searchProducts, getProduct, utmUrl } from './shopify.js';
import { geminiJson } from './gemini.js';
import { claudeJson } from './claude.js';
import { renderCreative } from './render.js';
import { sendText, sendPhotos, approvalKeyboard, telegramEnabled } from './telegram.js';

const newRunId = () => `cr-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`;

function scoreProduct(p, cfg) {
  const ageDays = (Date.now() - new Date(p.createdAt).getTime()) / 86400000;
  let score = 0;
  if (ageDays <= cfg.new_product_days) score += cfg.weight_new;
  if (p.inventory >= cfg.overstock_threshold) score += cfg.weight_overstock;
  if (p.inventory > 0 && p.inventory <= cfg.low_stock_threshold) score += cfg.weight_low_stock;
  return score;
}

/** Passo 1: escolhe o produto (ou usa o que o Pedro pediu). */
export async function curate({ query = '', productId = '', force = false } = {}) {
  if (!force && !query && !productId && getSetting('paused') === '1') {
    return { skipped: true, reason: 'Geração diária pausada pelo bot de comando.' };
  }
  const skill = loadSkill('shopify-curator');
  const cfg = skill.config;
  let product;
  if (productId) {
    product = await getProduct(productId);
  } else {
    const candidates = (await searchProducts(query, Number(cfg.candidates_limit ?? 50))).filter(
      (p) => p.images.length > 0 && (p.inventory ?? 1) > 0,
    );
    const fresh = query ? candidates : candidates.filter((p) => !productUsedSince(p.id, Number(cfg.min_days_between_repeats ?? 14)));
    const pool = fresh.length ? fresh : candidates;
    pool.sort((a, b) => scoreProduct(b, cfg) - scoreProduct(a, cfg) || new Date(b.createdAt) - new Date(a.createdAt));
    product = pool[0];
  }
  if (!product) throw new Error(query ? `Nenhum produto ativo com foto encontrado para "${query}".` : 'Nenhum produto ativo com foto encontrado.');

  const runId = newRunId();
  createRun(runId);
  const url = utmUrl(product, runId, cfg);
  updateRun(runId, { status: 'curated', product_id: product.id, product_json: product, utm_url: url });
  return { runId, product: { title: product.title, price: product.price, inventory: product.inventory, url } };
}

/** Passo 2: Gemini analisa as fotos. */
export async function analyze({ runId }) {
  const run = mustRun(runId);
  const skill = loadSkill('product-vision');
  const p = run.product;
  const prompt = `${skill.prompt}

Responda SOMENTE com JSON válido neste formato (JSON Schema):
${JSON.stringify(skill.schema)}

Produto:
- Título: ${p.title}
- Preço: R$ ${p.price}${p.compareAtPrice ? ` (de R$ ${p.compareAtPrice})` : ''}
- Tipo: ${p.productType || '-'} | Tags: ${(p.tags || []).join(', ') || '-'}
- Descrição: ${p.description || '-'}`;
  const vision = await geminiJson({
    model: skill.config.model,
    prompt,
    imageUrls: p.images.slice(0, Number(skill.config.max_images ?? 4)),
    temperature: Number(skill.config.temperature ?? 0.4),
  });
  updateRun(runId, { status: 'analyzed', vision_json: vision });
  return { runId, vision };
}

function briefing(run, extra = '') {
  const ctx = loadContext();
  const p = run.product;
  return `# Identidade da marca
${ctx.brand}

# Memória de performance
${ctx.performance}

# Produto (dados reais da Shopify)
- Título: ${p.title}
- Preço: R$ ${p.price}${p.compareAtPrice ? ` (preço cheio R$ ${p.compareAtPrice})` : ''}
- Estoque total: ${p.inventory ?? 'não informado'}
- Criado em: ${p.createdAt}
- Link com UTM: ${run.utm_url}
- Fotos disponíveis: ${p.images.length} (índices 0 a ${p.images.length - 1})
- Descrição: ${p.description || '-'}

# Análise visual (Gemini)
${JSON.stringify(run.vision, null, 2)}
${extra}`;
}

/** Passo 3: Claude cria ângulos, roteiro de vídeo e carrossel. */
export async function script({ runId }) {
  const run = mustRun(runId);
  const feedback = run.feedback ? `\n# Ajuste pedido pelo Pedro na versão anterior (prioridade máxima)\n${run.feedback}\n` : '';
  const base = briefing(run, feedback);

  const angles = await claudeJson({ skill: loadSkill('creative-angles'), userContent: base });
  const withAngle = `${base}\n# Ângulos (use o recomendado: ${angles.recomendado})\n${JSON.stringify(angles, null, 2)}`;

  const [video, carousel] = await Promise.all([
    claudeJson({ skill: loadSkill('tiktok-ugc-director'), userContent: withAngle }),
    claudeJson({ skill: loadSkill('ig-carousel-copywriter'), userContent: withAngle }),
  ]);
  updateRun(runId, { status: 'scripted', angles_json: angles, video_json: video, carousel_json: carousel });
  return { runId, angulo: angles.recomendado, gancho: angles.angulos.find((a) => a.tipo === angles.recomendado)?.gancho };
}

/** Passo 4: motores de mídia (Higgsfield). */
export async function render({ runId }) {
  const run = mustRun(runId);
  const result = await renderCreative(run);
  updateRun(runId, { status: 'rendered', render_json: result });
  return { runId, render: result };
}

function reviewText(run) {
  const a = run.angles;
  const rec = a.angulos.find((x) => x.tipo === a.recomendado);
  const c = run.carousel;
  const v = run.video;
  const slides = c.laminas.map((l) => `${l.numero}. ${l.texto}${l.imagem === 'lifestyle' ? '  [lifestyle]' : `  [foto ${l.foto_original_indice ?? 0}]`}`).join('\n');
  const scenes = v.cenas.map((s) => `${s.inicio_s}-${s.fim_s}s: ${s.texto_na_tela}${s.narracao ? ` | 🎙 ${s.narracao}` : ''}`).join('\n');
  const renderNote = run.render?.status === 'done' ? `Mídia gerada: ${run.render.assets.length} arquivo(s).` : `Mídia: ${run.render?.reason ?? 'não gerada'}`;
  return `🌸 Criativo do dia (${run.id})
Produto: ${run.product.title} | R$ ${run.product.price} | estoque ${run.product.inventory ?? '-'}
Ângulo: ${a.recomendado} (consciência ${rec?.nivel_consciencia}) | Gancho: "${rec?.gancho}"
Por quê: ${a.motivo}

📱 CARROSSEL
${slides}

Legenda:
${c.legenda}
${c.hashtags.join(' ')}

🎬 REELS/TIKTOK (${v.duracao_segundos}s)
${scenes}

${renderNote}
Link: ${run.utm_url}`;
}

/** Passo 5: manda para aprovação no Telegram. */
export async function review({ runId }) {
  const run = mustRun(runId);
  if (!telegramEnabled()) throw new Error('Telegram não configurado (TELEGRAM_BOT_TOKEN e TELEGRAM_ALLOWED_USER_ID).');
  const photos = run.render?.status === 'done' && run.render.assets.length ? run.render.assets.map((x) => x.url) : run.product.images.slice(0, 4);
  await sendPhotos(photos, `${run.product.title}`);
  await sendText(reviewText(run), approvalKeyboard(runId));
  updateRun(runId, { status: 'awaiting_approval' });
  return { runId, status: 'awaiting_approval' };
}

/** Executa todos os passos em sequência (usado pelo bot e por testes manuais). */
export async function runAll(opts = {}) {
  const cur = await curate({ ...opts, force: true });
  const { runId } = cur;
  try {
    await analyze({ runId });
    await script({ runId });
    await render({ runId });
    await review({ runId });
    return { runId, product: cur.product };
  } catch (err) {
    updateRun(runId, { status: 'failed', error: err.message });
    throw err;
  }
}

/** Refaz copy, mídia e revisão depois de um "Pedir ajuste". */
export async function redo(runId, feedback) {
  const run = mustRun(runId);
  const merged = [run.feedback, feedback].filter(Boolean).join('\n- ');
  updateRun(runId, { feedback: merged, status: 'adjusting' });
  await script({ runId });
  await render({ runId });
  await review({ runId });
}

export function mustRun(runId) {
  const run = getRun(runId);
  if (!run) throw new Error(`Criativo ${runId} não encontrado.`);
  return run;
}
