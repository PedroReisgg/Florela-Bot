import { config } from './config.js';

const api = (method) => `https://api.telegram.org/bot${config.telegram.token}/${method}`;

export const telegramEnabled = () => Boolean(config.telegram.token && config.telegram.allowedUserId);

export async function tg(method, payload = {}) {
  const res = await fetch(api(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.ok) throw new Error(`Telegram ${method}: ${body.description ?? res.status}`);
  return body.result;
}

/** O bot só conversa com o dono (o chat privado tem o mesmo id do usuário). */
const ownerChat = () => config.telegram.allowedUserId;

function chunks(text, size = 3900) {
  const out = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size / 2) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  out.push(rest);
  return out;
}

export async function sendText(text, extra = {}) {
  const parts = chunks(text);
  let last;
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    last = await tg('sendMessage', { chat_id: ownerChat(), text: parts[i], ...(isLast ? extra : {}) });
  }
  return last;
}

export async function sendPhotos(urls, caption = '') {
  const media = urls.slice(0, 10).map((u, i) => ({ type: 'photo', media: u, ...(i === 0 ? { caption: caption.slice(0, 1000) } : {}) }));
  if (media.length === 1) return tg('sendPhoto', { chat_id: ownerChat(), photo: urls[0], caption: caption.slice(0, 1000) });
  if (media.length > 1) return tg('sendMediaGroup', { chat_id: ownerChat(), media });
}

export const approvalKeyboard = (runId) => ({
  reply_markup: {
    inline_keyboard: [
      [
        { text: '✅ Aprovar e postar', callback_data: `ap:${runId}` },
        { text: '✏️ Pedir ajuste', callback_data: `aj:${runId}` },
      ],
      [{ text: '🗑 Descartar', callback_data: `dc:${runId}` }],
    ],
  },
});

/** Long polling: não precisa de domínio nem HTTPS. */
export async function startPolling(onUpdate) {
  let offset = 0;
  await tg('deleteWebhook', { drop_pending_updates: false }).catch(() => {});
  console.log('[telegram] polling iniciado');
  for (;;) {
    try {
      const updates = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
      for (const u of updates) {
        offset = u.update_id + 1;
        const from = u.message?.from?.id ?? u.callback_query?.from?.id;
        if (String(from) !== String(config.telegram.allowedUserId)) {
          console.warn(`[telegram] ignorando usuário ${from}`);
          continue;
        }
        onUpdate(u).catch((err) => {
          console.error('[telegram] erro ao tratar update', err);
          sendText(`⚠️ Erro: ${err.message}`).catch(() => {});
        });
      }
    } catch (err) {
      console.error('[telegram] polling falhou, tentando de novo em 5s:', err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
