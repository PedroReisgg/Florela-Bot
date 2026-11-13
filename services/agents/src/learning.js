import { loadSkill, loadContext } from './config.js';
import { runsSince } from './db.js';
import { paidOrdersSince } from './shopify.js';
import { claudeText } from './claude.js';
import { proposeFileChange } from './github.js';
import { sendText, telegramEnabled } from './telegram.js';

/** Loop semanal: cruza criativos com pedidos pagos e propõe nova memória de performance via PR. */
export async function weeklyLearning() {
  const skill = loadSkill('performance-analyst');
  const days = Number(skill.config.lookback_days ?? 7);
  const runs = runsSince(days).map((r) => {
    const angles = r.angles_json ? JSON.parse(r.angles_json) : null;
    const product = r.product_json ? JSON.parse(r.product_json) : null;
    return {
      id: r.id,
      data: r.created_at,
      status: r.status,
      produto: product?.title,
      angulo: angles?.recomendado,
      gancho: angles?.angulos?.find((a) => a.tipo === angles.recomendado)?.gancho,
      ajustes_do_pedro: r.feedback,
    };
  });
  const orders = await paidOrdersSince(days);
  const fromCreatives = orders.filter((o) => o.utm?.campaign === 'criativo-diario');
  const summary = {
    periodo_dias: days,
    criativos: runs,
    pedidos_pagos_total: orders.length,
    receita_total: orders.reduce((s, o) => s + o.total, 0).toFixed(2),
    pedidos_com_utm_de_criativo: fromCreatives.map((o) => ({ pedido: o.name, total: o.total, criativo: o.utm?.content, itens: o.items })),
  };
  const ctx = loadContext();
  const markdown = await claudeText({
    skill,
    userContent: `# Memória atual\n${ctx.performance}\n\n# Dados da semana\n${JSON.stringify(summary, null, 2)}`,
  });
  const pr = await proposeFileChange({
    path: 'context/performance-memory.md',
    content: markdown.endsWith('\n') ? markdown : `${markdown}\n`,
    title: `Memória de performance: semana até ${new Date().toISOString().slice(0, 10)}`,
    description: `Resumo: ${runs.length} criativos, ${orders.length} pedidos pagos, ${fromCreatives.length} com UTM dos criativos.`,
  });
  if (telegramEnabled()) await sendText(`📊 Aprendizado semanal pronto. Revise e aprove: ${pr.url}`);
  return { pr: pr.url, summary: { criativos: runs.length, pedidos: orders.length, pedidos_criativos: fromCreatives.length } };
}
