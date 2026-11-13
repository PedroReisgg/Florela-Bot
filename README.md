# Florela Bot

Ecossistema de marketing automático da [Florela](https://www.florela.com.br): todo dia o sistema escolhe um
produto na Shopify, analisa as fotos com o Gemini, escreve carrossel e roteiro de Reels/TikTok com o Claude
e manda tudo para o Pedro aprovar pelo Telegram. Aprovado, publica no Instagram. Uma vez por semana cruza os
criativos com as vendas e propõe (via Pull Request) uma nova memória de performance.

## Como funciona

```text
n8n (agenda 07:00) ──► agents:3000
                        1. /pipeline/curate   Shopify Admin API (produto do dia + link com UTM)
                        2. /pipeline/analyze  Gemini (visão das fotos)
                        3. /pipeline/script   Claude (ângulos, carrossel, roteiro de vídeo)
                        4. /pipeline/render   Higgsfield (ponto de encaixe, ainda desligado)
                        5. /pipeline/review   Telegram (Aprovar / Pedir ajuste / Descartar)
Telegram ◄──► agents (long polling, sem precisar de domínio)
                        Aprovar  ──► Instagram Graph API
                        Ajuste   ──► refaz copy com o seu comentário
                        Texto livre ──► bot de comando (Claude com ferramentas)
n8n (segunda 08:00) ──► /learning/weekly ──► PR em context/performance-memory.md
```

| Pasta | O que tem |
| --- | --- |
| `context/` | Identidade da marca e memória de performance, lidas por todos os agentes |
| `skills/` | Uma pasta por agente: `config.yaml` (modelo e parâmetros), `prompt.md`, `output-schema.json` |
| `services/agents/` | Serviço Node.js que executa cada passo e o bot do Telegram |
| `n8n/workflows/` | Workflows importados automaticamente no n8n |
| `scripts/install.sh` | Instala ou atualiza tudo na instância |

As skills são lidas do disco a cada execução e a instância faz `git pull` a cada 10 minutos. Então editar um
`prompt.md` no GitHub (ou aprovar um PR aberto pelo bot) muda o comportamento no próximo criativo, sem deploy.

## Instalação na instância (AWS)

Conectado por SSH na instância:

```bash
git clone -b claude/project-thread-58zlgu https://github.com/PedroReisgg/Florela-Bot.git ~/florela-bot
bash ~/florela-bot/scripts/install.sh
```

O script reaproveita as senhas e os dados do n8n que já estavam em `~/florela`, sobe `postgres`, `n8n` e
`agents`, importa os workflows e agenda o `git pull`. Depois:

1. Preencha as chaves no `.env`: `nano ~/florela-bot/.env`, e rode `cd ~/florela-bot && sudo docker compose up -d`.
2. Confira: `sudo docker compose exec agents node -e "fetch('http://localhost:3000/health').then(r=>r.text()).then(console.log)"`.
3. No Telegram, mande `/start` para o seu bot. Teste com `/gerar`.
4. No n8n (túnel SSH, `http://localhost:5678`), abra **Florela – Criativo diário**, rode "Rodar agora" e ative o workflow.

### Chaves necessárias

| Variável | Onde conseguir |
| --- | --- |
| `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN` | Shopify > Configurações > Apps > Desenvolver apps. Escopos `read_products`, `read_orders`, `read_inventory` |
| `GEMINI_API_KEY` | Google AI Studio |
| `ANTHROPIC_API_KEY` | Claude Console |
| `TELEGRAM_BOT_TOKEN` | @BotFather no Telegram |
| `TELEGRAM_ALLOWED_USER_ID` | Seu id numérico (@userinfobot). O bot ignora qualquer outra pessoa |
| `IG_USER_ID`, `IG_ACCESS_TOKEN` | App Meta com Instagram Graph API, conta Profissional ligada a uma Página |
| `GITHUB_TOKEN` | Token fine-grained só deste repositório: Contents e Pull requests com escrita |
| `HIGGSFIELD_API_KEY` | Só depois de confirmarmos a API HTTP do seu plano |

Sem uma chave, o passo correspondente avisa no Telegram em vez de quebrar em silêncio.

## Bot de comando (Telegram)

- `/gerar` gera um criativo agora. `/status` mostra gasto do dia e últimos criativos.
- `/pausar` e `/retomar` controlam a geração diária. `/novo` reinicia a conversa.
- Texto livre: "gera um criativo do vestido floral", "quanto vendi essa semana?", "deixa o gancho do TikTok mais
  divertido". Mudanças em skills viram Pull Request no GitHub; o bot nunca altera arquivos direto nem mostra chaves.

## Custos e segurança

- `DAILY_BUDGET_USD` (padrão US$ 3) trava as chamadas de IA quando o gasto estimado do dia passa do teto.
- Modelos: `claude-sonnet-5-5` para copy, `claude-opus-5-5` para o bot de comando, Gemini Flash para visão.
  Troque em `skills/*/config.yaml`.
- O n8n e os agentes não ficam expostos na internet. O Telegram usa long polling, então funciona sem domínio.
- Para HTTPS (DuckDNS), preencha `N8N_DOMAIN` e rode `sudo docker compose --profile https up -d`. Libere as portas 80 e 443 no firewall da AWS.

## Pendências conhecidas

- **Render de mídia (Higgsfield):** `services/agents/src/render.js` é o ponto de encaixe. Até lá, a aprovação
  e a publicação usam as fotos originais da Shopify, e os prompts de vídeo e imagem já saem prontos no criativo.
- **TikTok:** a Content Posting API exige auditoria do app; enquanto isso, publique o vídeo manualmente.
- **Identidade da marca:** complete os campos `[PREENCHER]` em `context/brand-identity.md`.
