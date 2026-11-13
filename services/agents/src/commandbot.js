import { loadSkill, listSkills, readRepoFile, config } from './config.js';
import { getSetting, setSetting, costToday, recentRuns, updateRun } from './db.js';
import { searchProducts, paidOrdersSince } from './shopify.js';
import { createMessage, textOf } from './claude.js';
import { proposeFileChange } from './github.js';
import { runAll, redo, mustRun } from './pipeline.js';
import { publishToInstagram } from './publish.js';
import { sendText, tg } from './telegram.js';

// Conversa do bot (em memória). Recomeça do zero em vez de cortar o histórico.
let history = [];
let awaitingAdjust = null; // runId esperando o texto do ajuste

const tools = [
  {
    name: 'gerar_criativo',
    description: 'Gera um criativo completo agora e envia para aprovação. Opcionalmente filtra o produto por texto de busca da Shopify.',
    input_schema: { type: 'object', properties: { busca_produto: { type: 'string', description: 'Ex.: "vestido floral". Vazio = curadoria automática.' } }, additionalProperties: false },
  },
  { name: 'status', description: 'Mostra últimos criativos, gasto do dia e se a geração diária está pausada.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'pausar_geracao_diaria', description: 'Pausa a geração automática diária.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'retomar_geracao_diaria', description: 'Retoma a geração automática diária.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  {
    name: 'buscar_produtos',
    description: 'Busca produtos ativos na Shopify (título, preço, estoque, link).',
    input_schema: { type: 'object', properties: { busca: { type: 'string' } }, required: ['busca'], additionalProperties: false },
  },
  {
    name: 'vendas',
    description: 'Resumo de pedidos pagos nos últimos N dias, com origem UTM.',
    input_schema: { type: 'object', properties: { dias: { type: 'integer', minimum: 1, maximum: 60 } }, required: ['dias'], additionalProperties: false },
  },
  { name: 'listar_skills', description: 'Lista as skills disponíveis.', input_schema: { type: 'object', properties: {}, additionalProperties: false } },
  {
    name: 'ler_arquivo',
    description: 'Lê um arquivo de skill ou contexto. Ex.: skills/tiktok-ugc-director/prompt.md ou context/brand-identity.md',
    input_schema: { type: 'object', properties: { caminho: { type: 'string' } }, required: ['caminho'], additionalProperties: false },
  },
  {
    name: 'propor_alteracao',
    description:
      'Abre um Pull Request no GitHub trocando o conteúdo INTEIRO de um arquivo de skill ou contexto. Leia o arquivo antes e envie o texto completo novo.',
    input_schema: {
      type: 'object',
      properties: {
        caminho: { type: 'string' },
        novo_conteudo: { type: 'string' },
        titulo: { type: 'string' },
        descricao: { type: 'string' },
      },
      required: ['caminho', 'novo_conteudo', 'titulo', 'descricao'],
      additionalProperties: false,
    },
  },
];

async function runTool(name, input) {
  switch (name) {
    case 'gerar_criativo':
      runAll({ query: input.busca_produto ?? '' }).catch((err) => sendText(`⚠️ Falha ao gerar criativo: ${err.message}`));
      return 'Geração iniciada em segundo plano. O criativo chega aqui para aprovação em alguns minutos.';
    case 'status':
      return JSON.stringify({ pausado: getSetting('paused') === '1', gasto_hoje_usd: costToday().toFixed(2), teto_usd: config.dailyBudgetUsd, ultimos: recentRuns(5) });
    case 'pausar_geracao_diaria':
      setSetting('paused', '1');
      return 'Geração diária pausada.';
    case 'retomar_geracao_diaria':
      setSetting('paused', '0');
      return 'Geração diária retomada.';
    case 'buscar_produtos': {
      const items = await searchProducts(input.busca, 10);
      return JSON.stringify(items.map((p) => ({ id: p.id, titulo: p.title, preco: p.price, estoque: p.inventory, link: p.url })));
    }
    case 'vendas': {
      const orders = await paidOrdersSince(input.dias);
      return JSON.stringify({
        pedidos: orders.length,
        receita: orders.reduce((s, o) => s + o.total, 0).toFixed(2),
        com_utm_criativo: orders.filter((o) => o.utm?.campaign === 'criativo-diario').length,
        ultimos: orders.slice(0, 10).map((o) => ({ pedido: o.name, total: o.total, origem: o.utm?.source ?? null })),
      });
    }
    case 'listar_skills':
      return listSkills().join(', ');
    case 'ler_arquivo':
      if (!/^(skills|context)\//.test(input.caminho) || input.caminho.includes('..')) return 'Só posso ler arquivos em skills/ ou context/.';
      return readRepoFile(input.caminho);
    case 'propor_alteracao': {
      const pr = await proposeFileChange({ path: input.caminho, content: input.novo_conteudo, title: input.titulo, description: input.descricao });
      return `Pull Request aberto: ${pr.url}`;
    }
    default:
      return `Ferramenta desconhecida: ${name}`;
  }
}

async function chat(userText) {
  const skill = loadSkill('command-bot');
  if (history.length > 40) history = [];
  history.push({ role: 'user', content: userText });
  const maxRounds = Number(skill.config.max_tool_rounds ?? 6);
  for (let round = 0; round < maxRounds; round++) {
    const response = await createMessage(
      {
        model: skill.config.model,
        max_tokens: Number(skill.config.max_tokens ?? 2000),
        system: skill.prompt,
        tools,
        messages: history,
        output_config: { effort: 'medium' },
      },
      'command-bot',
    );
    history.push({ role: 'assistant', content: response.content });
    const calls = response.content.filter((b) => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !calls.length) return textOf(response) || 'Feito.';
    const results = await Promise.all(
      calls.map(async (call) => {
        try {
          return { type: 'tool_result', tool_use_id: call.id, content: String(await runTool(call.name, call.input)) };
        } catch (err) {
          return { type: 'tool_result', tool_use_id: call.id, content: `Erro: ${err.message}`, is_error: true };
        }
      }),
    );
    history.push({ role: 'user', content: results });
  }
  return 'Parei aqui para não gastar demais. Me diga se devo continuar.';
}

async function handleCallback(cb) {
  const [action, runId] = cb.data.split(':');
  await tg('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
  const run = mustRun(runId);
  if (action === 'ap') {
    if (run.status === 'published') return sendText('Esse criativo já foi publicado.');
    updateRun(runId, { status: 'approved' });
    const result = await publishToInstagram(runId);
    return sendText(result.published ? `✅ Publicado no Instagram (${result.mediaId}).` : `✅ Aprovado. Não publiquei: ${result.reason}`);
  }
  if (action === 'dc') {
    updateRun(runId, { status: 'discarded' });
    return sendText('🗑 Descartado. Se quiser, me diga o motivo que eu registro para aprender.');
  }
  if (action === 'aj') {
    awaitingAdjust = runId;
    return sendText('✏️ O que você quer mudar? Escreva o ajuste (ex.: "gancho mais divertido", "foca no preço").');
  }
}

export async function handleUpdate(update) {
  if (update.callback_query) return handleCallback(update.callback_query);
  const text = update.message?.text?.trim();
  if (!text) return;
  if (text === '/start' || text === '/ajuda') {
    return sendText('Oi, Pedro! Comandos: /gerar, /status, /pausar, /retomar, /novo (nova conversa). Ou só me peça em texto.');
  }
  if (text === '/novo') {
    history = [];
    return sendText('Conversa reiniciada.');
  }
  if (text === '/gerar') return sendText(await runTool('gerar_criativo', {}));
  if (text === '/status') return sendText(await runTool('status', {}));
  if (text === '/pausar') return sendText(await runTool('pausar_geracao_diaria', {}));
  if (text === '/retomar') return sendText(await runTool('retomar_geracao_diaria', {}));
  if (awaitingAdjust) {
    const runId = awaitingAdjust;
    awaitingAdjust = null;
    await sendText('Refazendo com o seu ajuste...');
    return redo(runId, text);
  }
  await tg('sendChatAction', { chat_id: config.telegram.allowedUserId, action: 'typing' }).catch(() => {});
  return sendText(await chat(text));
}
