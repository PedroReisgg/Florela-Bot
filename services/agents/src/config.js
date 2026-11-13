import fs from 'node:fs';
import path from 'node:path';

const env = (name, fallback = '') => (process.env[name] ?? fallback).trim();

export const config = {
  port: Number(env('PORT', '3000')),
  repoDir: env('REPO_DIR', '/app/repo'),
  dataDir: env('DATA_DIR', '/data'),
  timezone: env('TZ', 'America/Sao_Paulo'),
  dailyBudgetUsd: Number(env('DAILY_BUDGET_USD', '3')),

  shopify: {
    store: env('SHOPIFY_STORE_DOMAIN'), // ex.: florela.myshopify.com
    token: env('SHOPIFY_ADMIN_TOKEN'),
    apiVersion: env('SHOPIFY_API_VERSION', '2025-10'),
    publicUrl: env('STORE_PUBLIC_URL', 'https://www.florela.com.br'),
  },
  gemini: {
    apiKey: env('GEMINI_API_KEY'),
    priceInPerM: Number(env('GEMINI_PRICE_IN_PER_M', '0.30')),
    priceOutPerM: Number(env('GEMINI_PRICE_OUT_PER_M', '2.50')),
  },
  anthropic: {
    apiKey: env('ANTHROPIC_API_KEY'),
    // "default" liga o fallback do servidor quando um modelo recusa; "off" desliga.
    fallbacks: env('CLAUDE_FALLBACKS', 'default'),
  },
  telegram: {
    token: env('TELEGRAM_BOT_TOKEN'),
    allowedUserId: env('TELEGRAM_ALLOWED_USER_ID'),
  },
  instagram: {
    userId: env('IG_USER_ID'),
    accessToken: env('IG_ACCESS_TOKEN'),
    graphVersion: env('META_GRAPH_VERSION', 'v23.0'),
  },
  higgsfield: {
    apiKey: env('HIGGSFIELD_API_KEY'),
  },
  github: {
    token: env('GITHUB_TOKEN'),
    repo: env('GITHUB_REPO', 'PedroReisgg/Florela-Bot'),
    base: env('GITHUB_BASE_BRANCH', 'claude/project-thread-58zlgu'),
  },
};

// Preço por milhão de tokens (US$), usado só para o controle de gasto diário.
export const CLAUDE_PRICES = {
  'claude-opus-5-5': { in: 4, out: 20 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5 },
};

/** Lê um YAML simples (chave: valor por linha, com comentários #). */
export function parseSimpleYaml(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (value === 'true' || value === 'false') value = value === 'true';
    else if (value !== '' && !Number.isNaN(Number(value))) value = Number(value);
    out[key] = value;
  }
  return out;
}

export function repoPath(...parts) {
  const full = path.resolve(config.repoDir, ...parts);
  if (!full.startsWith(path.resolve(config.repoDir))) throw new Error('Caminho fora do repositório');
  return full;
}

export function readRepoFile(relPath) {
  return fs.readFileSync(repoPath(relPath), 'utf8');
}

/** Carrega uma skill do disco a cada uso, então mudanças no repo valem na próxima execução. */
export function loadSkill(name) {
  const dir = repoPath('skills', name);
  const cfg = parseSimpleYaml(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8'));
  const prompt = fs.readFileSync(path.join(dir, 'prompt.md'), 'utf8');
  const schemaPath = path.join(dir, 'output-schema.json');
  const schema = fs.existsSync(schemaPath) ? JSON.parse(fs.readFileSync(schemaPath, 'utf8')) : null;
  return { name, config: cfg, prompt, schema };
}

export function loadContext() {
  return {
    brand: readRepoFile('context/brand-identity.md'),
    performance: readRepoFile('context/performance-memory.md'),
  };
}

export function listSkills() {
  return fs
    .readdirSync(repoPath('skills'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}
