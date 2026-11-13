import { config } from './config.js';
import { updateRun } from './db.js';
import { mustRun } from './pipeline.js';

const graph = (path) => `https://graph.facebook.com/${config.instagram.graphVersion}/${path}`;

async function post(path, params) {
  const body = new URLSearchParams({ ...params, access_token: config.instagram.accessToken });
  const res = await fetch(graph(path), { method: 'POST', body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`Instagram ${path}: ${json.error?.message ?? res.status}`);
  return json;
}

async function waitReady(containerId) {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${graph(containerId)}?fields=status_code&access_token=${encodeURIComponent(config.instagram.accessToken)}`);
    const json = await res.json();
    if (json.status_code === 'FINISHED') return;
    if (json.status_code === 'ERROR') throw new Error('Instagram recusou a mídia.');
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Instagram demorou demais para processar a mídia.');
}

export const instagramEnabled = () => Boolean(config.instagram.userId && config.instagram.accessToken);

/**
 * Publica no feed. Hoje usa as fotos (renderizadas ou originais) com a legenda aprovada.
 * As lâminas com texto entram quando o motor de render (Higgsfield/template) estiver ativo.
 */
export async function publishToInstagram(runId) {
  const run = mustRun(runId);
  if (!instagramEnabled()) return { published: false, reason: 'Instagram não configurado (IG_USER_ID e IG_ACCESS_TOKEN).' };
  const images =
    run.render?.status === 'done' ? run.render.assets.filter((a) => a.type === 'image').map((a) => a.url) : run.product.images.slice(0, 5);
  const caption = `${run.carousel.legenda}\n\n${run.carousel.hashtags.join(' ')}`.slice(0, 2200);
  const igUser = config.instagram.userId;
  let creationId;
  if (images.length >= 2) {
    const children = [];
    for (const url of images.slice(0, 10)) {
      const c = await post(`${igUser}/media`, { image_url: url, is_carousel_item: 'true' });
      children.push(c.id);
    }
    const parent = await post(`${igUser}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption });
    creationId = parent.id;
  } else {
    const single = await post(`${igUser}/media`, { image_url: images[0], caption });
    creationId = single.id;
  }
  await waitReady(creationId);
  const published = await post(`${igUser}/media_publish`, { creation_id: creationId });
  updateRun(runId, { ig_media_id: published.id, status: 'published' });
  return { published: true, mediaId: published.id };
}
