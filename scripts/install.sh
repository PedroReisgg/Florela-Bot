#!/usr/bin/env bash
# Instala ou atualiza a Florela na instância (Amazon Linux 2023 com Docker já instalado).
# Uso:  bash ~/florela-bot/scripts/install.sh
set -euo pipefail

REPO_DIR="$HOME/florela-bot"
OLD_DIR="$HOME/florela"
cd "$REPO_DIR"

echo "==> Pacotes (git e cron)"
sudo dnf install -y -q git cronie >/dev/null
sudo systemctl enable --now crond >/dev/null 2>&1 || true

echo "==> Arquivo .env"
if [ ! -f .env ]; then
  if [ -f "$OLD_DIR/.env" ]; then
    cp "$OLD_DIR/.env" .env
    echo "    senhas do n8n/Postgres copiadas de $OLD_DIR/.env"
  else
    cp .env.example .env
    sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 16)/" .env
    sed -i "s/^N8N_ENCRYPTION_KEY=.*/N8N_ENCRYPTION_KEY=$(openssl rand -hex 24)/" .env
  fi
fi
# acrescenta chaves novas do .env.example que ainda não existem no .env
while IFS= read -r line; do
  case "$line" in ''|\#*) continue ;; esac
  key="${line%%=*}"
  grep -q "^${key}=" .env || echo "$line" >> .env
done < .env.example
chmod 600 .env

echo "==> Parando a stack antiga (os dados ficam nos volumes)"
if [ -f "$OLD_DIR/docker-compose.yml" ]; then
  (cd "$OLD_DIR" && sudo docker compose down) || true
fi

echo "==> Subindo n8n, Postgres e agentes"
sudo docker compose up -d --build

echo "==> Aguardando o n8n"
for i in $(seq 1 30); do
  if sudo docker compose exec -T n8n wget -q -O /dev/null http://localhost:5678/healthz 2>/dev/null; then break; fi
  sleep 3
done

echo "==> Importando workflows do n8n"
sudo docker compose exec -T n8n n8n import:workflow --separate --input=/workflows

echo "==> Atualização automática das skills (git pull a cada 10 min)"
CRON_LINE="*/10 * * * * cd $REPO_DIR && git pull --ff-only -q >/dev/null 2>&1"
( crontab -l 2>/dev/null | grep -v "florela-bot && git pull" ; echo "$CRON_LINE" ) | crontab -

echo "==> Status do serviço de agentes"
sudo docker compose exec -T agents node -e "fetch('http://localhost:3000/health').then(r=>r.text()).then(t=>console.log(t))"

echo
echo "Pronto. Próximos passos:"
echo " 1) Preencha as chaves em $REPO_DIR/.env (nano .env) e rode: sudo docker compose up -d"
echo " 2) Abra o n8n pelo túnel SSH e ative o workflow 'Florela – Criativo diário'."
