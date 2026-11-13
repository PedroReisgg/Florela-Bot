import { config } from './config.js';
import { addCost, assertBudget } from './db.js';

async function imageToPart(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar imagem ${url}: ${res.status}`);
  const mime = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
  const data = Buffer.from(await res.arrayBuffer()).toString('base64');
  return { inline_data: { mime_type: mime, data } };
}

/** Chama o Gemini com texto + imagens e devolve JSON. */
export async function geminiJson({ model, prompt, imageUrls = [], temperature = 0.4 }) {
  if (!config.gemini.apiKey) throw new Error('GEMINI_API_KEY não configurada.');
  assertBudget();
  const parts = [{ text: prompt }];
  for (const url of imageUrls) parts.push(await imageToPart(url));
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.gemini.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature, responseMimeType: 'application/json' },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${JSON.stringify(body.error ?? body).slice(0, 400)}`);
  const usage = body.usageMetadata ?? {};
  const usd =
    ((usage.promptTokenCount ?? 0) * config.gemini.priceInPerM + (usage.candidatesTokenCount ?? 0) * config.gemini.priceOutPerM) / 1e6;
  addCost('gemini', model, usd, 'vision');
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Gemini devolveu algo que não é JSON: ${text.slice(0, 200)}`);
  }
}
