import { config } from './config.js';

async function gh(method, path, body) {
  if (!config.github.token) throw new Error('GITHUB_TOKEN não configurado: não consigo abrir Pull Requests.');
  const res = await fetch(`https://api.github.com/repos/${config.github.repo}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.github.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'florela-agents',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${json.message ?? res.status}`);
  return json;
}

const ALLOWED = /^(skills\/[a-z0-9-]+\/(prompt\.md|config\.yaml|output-schema\.json)|context\/[a-z0-9-]+\.md)$/;

/** Abre um PR alterando UM arquivo de skill ou de contexto. Nunca altera código ou segredos. */
export async function proposeFileChange({ path, content, title, description }) {
  if (!ALLOWED.test(path)) throw new Error(`Só posso propor mudanças em skills/*/(prompt.md|config.yaml|output-schema.json) ou context/*.md. Recebi: ${path}`);
  const base = config.github.base;
  const ref = await gh('GET', `/git/ref/heads/${base}`);
  const branch = `bot/${path.replace(/[^a-z0-9]+/gi, '-')}-${Date.now().toString(36)}`;
  await gh('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: ref.object.sha });
  let sha;
  try {
    sha = (await gh('GET', `/contents/${path}?ref=${base}`)).sha;
  } catch {
    sha = undefined;
  }
  await gh('PUT', `/contents/${path}`, {
    message: title,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch,
    ...(sha ? { sha } : {}),
  });
  const pr = await gh('POST', '/pulls', {
    title,
    head: branch,
    base,
    body: `${description}\n\n---\nAberto pelo bot de comando da Florela. Revise e faça merge para valer na próxima execução.`,
  });
  return { url: pr.html_url, number: pr.number };
}
