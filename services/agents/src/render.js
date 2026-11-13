import { config } from './config.js';

/**
 * Motor de mídia. Ponto de encaixe do Higgsfield.
 *
 * Ainda não implementado: precisamos confirmar se o plano do Higgsfield do Pedro tem API HTTP
 * (endpoint, autenticação e preço por geração). O conector MCP usado nas conversas com o Claude
 * não serve para chamadas de servidor. Enquanto isso, a revisão usa as fotos originais da Shopify
 * e os roteiros e prompts já ficam prontos no criativo (video.cenas[].prompt_video_en e
 * carousel.laminas[].prompt_imagem_en).
 *
 * Contrato de retorno quando implementado:
 *   { status: 'done', assets: [{ type: 'image'|'video', url: 'https://...' }], usd: 0.0 }
 */
export async function renderCreative(run) {
  if (!config.higgsfield.apiKey) {
    return { status: 'skipped', reason: 'Higgsfield sem API configurada; usando fotos originais da Shopify.', assets: [] };
  }
  return {
    status: 'skipped',
    reason: 'Integração HTTP do Higgsfield ainda não implementada (aguardando documentação da API).',
    assets: [],
    prompts: {
      video: (run.video?.cenas ?? []).map((c) => c.prompt_video_en),
      images: (run.carousel?.laminas ?? []).filter((l) => l.prompt_imagem_en).map((l) => l.prompt_imagem_en),
    },
  };
}
