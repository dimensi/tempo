#!/usr/bin/env bash
set -euo pipefail
export BETTER_AUTH_SECRET="$(openssl rand -base64 48)"
export BETTER_AUTH_URL=https://nutrition.dimensi.dev
export COMPOSE_PROJECT_NAME=nutrition-smoke
export APP_PORT=3311
cleanup() { docker compose down -v; }
trap cleanup EXIT
# Disposable test volumes only; never run down -v on an operator's stack.
docker tag nutrition-foundation ghcr.io/dimensi/yazio-dashboard:latest
docker compose up -d --no-build
for attempt in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:3311/api/health > /dev/null; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:3311/api/health
# Exercise the bundled CLI and persisted SQLite inside the real non-root image.
docker compose exec -T -e CREATE_USER_EMAIL=smoke@example.test -e CREATE_USER_NAME=Smoke -e CREATE_USER_PASSWORD=Smoke-test-password-1234 app node scripts/create-user.mjs
docker compose exec -T app node -e "require('node:fs').writeFileSync('/app/uploads/smoke.txt','persistent-upload')"
docker compose exec -T app node --input-type=module -e "const r=await fetch('http://127.0.0.1:3000/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://nutrition.dimensi.dev'},body:JSON.stringify({email:'smoke@example.test',password:'Smoke-test-password-1234'})});const c=r.headers.get('set-cookie')??'';if(!r.ok||!c.includes('Secure')||!c.includes('HttpOnly')||!c.includes('SameSite=Lax'))process.exit(1)"
docker compose restart app
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3311/api/health > /dev/null; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:3311/api/health
docker compose exec -T app node -e "const D=require('better-sqlite3');const db=new D('/app/data/nutrition.sqlite');if(db.prepare('SELECT count(*) AS n FROM user').get().n!==1)process.exit(1);db.close()"
docker compose exec -T app node scripts/backup.mjs /app/data/smoke-backup.sqlite
docker compose exec -T app node -e "const D=require('better-sqlite3');const db=new D('/app/data/smoke-backup.sqlite');if(db.pragma('integrity_check',{simple:true})!=='ok'||db.prepare('SELECT count(*) AS n FROM user').get().n!==1)process.exit(1);db.close();if(require('node:fs').readFileSync('/app/uploads/smoke.txt','utf8')!=='persistent-upload')process.exit(1)"
