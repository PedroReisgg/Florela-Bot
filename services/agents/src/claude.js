import Anthropic from '@anthropic-ai/sdk';
import { config, CLAUDE_PRICES } from './config.js';
import { addCost, assertBudget } from './db.js';

let client;
function getClient() {
  if (!config.anthropic.apiKey) throw new Error('ANTHROPIC_API_KEY não configurada.');
  client ??= new Anthropic({ apiKey: config.anthropic.apiKey });
  return client;
}

function trackCost(model, usage, note) {
  const price = CLAUDE_PRICES[model] ?? CLAUDE_PRICES['claude-opus-5-5'];
  const inTokens = (usage?.input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) * 0.1;
  const usd = (inTokens * price.in + (usage?.output_tokens ?? 0) * price.out) / 1e6;
  addCost('anthropic', model, usd, note);
}

/** Structured outputs exigem additionalProperties:false em todo objeto. */
function strictSchema(schema) {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) out[k] = strictSchema(v);
  if (out.type === 'object' && out.additionalProperties === undefined) out.additionalProperties = false;
  return out;
}

/**
 * Envia uma requisição ao Messages API. Usa o fallback do servidor (refusal) quando
 * CLAUDE_FALLBACKS=default e repete sem ele se a conta não aceitar o parâmetro.
 */
export async function createMessage(params, note = '') {
  assertBudget();
  const c = getClient();
  let response;
  if (config.anthropic.fallbacks !== 'off') {
    try {
      response = await c.beta.messages.create({
        ...params,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: config.anthropic.fallbacks,
      });
    } catch (err) {
      if (err?.status !== 400 || !/fallback/i.test(String(err?.message))) throw err;
      console.warn('[claude] fallbacks recusado pela API, repetindo sem ele');
    }
  }
  response ??= await c.messages.create(params);
  trackCost(params.model, response.usage, note);
  if (response.stop_reason === 'refusal') {
    throw new Error(`Claude recusou a tarefa (${response.stop_details?.category ?? 'sem categoria'}).`);
  }
  return response;
}

export function textOf(response) {
  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Uma chamada que devolve JSON validado pelo schema da skill. */
export async function claudeJson({ skill, userContent, effort = 'medium' }) {
  const response = await createMessage(
    {
      model: skill.config.model,
      max_tokens: Number(skill.config.max_tokens ?? 4000),
      system: skill.prompt,
      messages: [{ role: 'user', content: userContent }],
      output_config: { effort, format: { type: 'json_schema', schema: strictSchema(skill.schema) } },
    },
    skill.name,
  );
  if (response.stop_reason === 'max_tokens') throw new Error(`Resposta cortada por max_tokens na skill ${skill.name}.`);
  return JSON.parse(textOf(response));
}

/** Uma chamada de texto livre (markdown). */
export async function claudeText({ skill, userContent, effort = 'medium' }) {
  const response = await createMessage(
    {
      model: skill.config.model,
      max_tokens: Number(skill.config.max_tokens ?? 4000),
      system: skill.prompt,
      messages: [{ role: 'user', content: userContent }],
      output_config: { effort },
    },
    skill.name,
  );
  return textOf(response);
}
