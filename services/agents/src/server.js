import http from 'node:http';
import { config } from './config.js';
import { costToday, recentRuns, getSetting } from './db.js';
import { curate, analyze, script, render, review, runAll } from './pipeline.js';
import { weeklyLearning } from './learning.js';
import { handleUpdate } from './commandbot.js';
import { startPolling, telegramEnabled, sendText } from './telegram.js';

const routes = {
  'POST /pipeline/curate': curate,
  'POST /pipeline/analyze': analyze,
  'POST /pipeline/script': script,
  'POST /pipeline/render': render,
  'POST /pipeline/review': review,
  'POST /pipeline/run': runAll,
  'POST /learning/weekly': weeklyLearning,
  'GET /status': async () => ({ paused: getSetting('paused') === '1', costTodayUsd: costToday(), budgetUsd: config.dailyBudgetUsd, runs: recentRuns(10) }),
  'GET /health': async () => ({
    ok: true,
    configured: {
      shopify: Boolean(config.shopify.store && config.shopify.token),
      gemini: Boolean(config.gemini.apiKey),
      anthropic: Boolean(config.anthropic.apiKey),
      telegram: telegramEnabled(),
      instagram: Boolean(config.instagram.userId && config.instagram.accessToken),
      higgsfield: Boolean(config.higgsfield.apiKey),
      github: Boolean(config.github.token),
    },
  }),
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('JSON inválido no corpo da requisição'));
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const key = `${req.method} ${req.url.split('?')[0]}`;
  const handler = routes[key];
  const send = (status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  };
  if (!handler) return send(404, { error: `Rota não encontrada: ${key}` });
  try {
    const body = req.method === 'POST' ? await readBody(req) : {};
    send(200, await handler(body));
  } catch (err) {
    console.error(`[${key}]`, err);
    if (telegramEnabled() && key.startsWith('POST')) sendText(`⚠️ ${key} falhou: ${err.message}`).catch(() => {});
    send(500, { error: err.message });
  }
});

server.listen(config.port, () => console.log(`[agents] ouvindo na porta ${config.port}`));

if (telegramEnabled()) startPolling(handleUpdate);
else console.warn('[telegram] desligado: defina TELEGRAM_BOT_TOKEN e TELEGRAM_ALLOWED_USER_ID');
