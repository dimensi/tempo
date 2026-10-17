#!/usr/bin/env bash
set -euo pipefail
export BETTER_AUTH_SECRET="$(openssl rand -base64 48)"
export BETTER_AUTH_URL=https://nutrition.dimensi.dev
export COMPOSE_PROJECT_NAME=nutrition-smoke
export APP_PORT=3311
export YAZIO_TOKEN_FILE=
pdf_smoke_dir=$(mktemp -d)
cleanup() { docker compose down -v; rm -rf "$pdf_smoke_dir"; }
trap cleanup EXIT
for pdf_tool in pdfinfo pdffonts pdftotext; do command -v "$pdf_tool" > /dev/null; done
# Disposable test volumes only; never run down -v on an operator's stack.
docker tag nutrition-foundation ghcr.io/dimensi/tempo:latest
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

# Real FFmpeg and object-storage Range in the shipped non-root runtime.
docker compose exec -T app node scripts/transformmate-media-smoke.mjs

# Genuine rendering in the non-root runtime; only synthetic Cyrillic content.
docker compose exec -T app node scripts/pdf-runtime-smoke.mjs /app/data/runtime-smoke.pdf
docker compose cp app:/app/data/runtime-smoke.pdf "$pdf_smoke_dir/runtime-smoke.pdf"
node scripts/verify-pdf-runtime.mjs "$pdf_smoke_dir/runtime-smoke.pdf"
# Restore rehearsal modifies only this disposable smoke project's database.
docker compose exec -T app node -e "const D=require('better-sqlite3');const db=new D('/app/data/nutrition.sqlite');if(db.prepare(\"UPDATE user SET name='Changed after backup' WHERE email='smoke@example.test'\").run().changes!==1)process.exit(1);db.close()"
docker compose stop app
docker compose run --rm --no-deps --entrypoint node app -e "const fs=require('node:fs');for(const suffix of ['-wal','-shm'])fs.rmSync('/app/data/nutrition.sqlite'+suffix,{force:true});fs.copyFileSync('/app/data/smoke-backup.sqlite','/app/data/nutrition.sqlite');const D=require('better-sqlite3');const db=new D('/app/data/nutrition.sqlite');if(db.pragma('integrity_check',{simple:true})!=='ok'||db.prepare(\"SELECT name FROM user WHERE email='smoke@example.test'\").get().name!=='Smoke')process.exit(1);db.close()"
docker compose up -d --no-build
for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3311/api/health > /dev/null; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:3311/api/health
docker compose exec -T app node -e "const D=require('better-sqlite3');const db=new D('/app/data/nutrition.sqlite');if(db.prepare(\"SELECT name FROM user WHERE email='smoke@example.test'\").get().name!=='Smoke')process.exit(1);db.close();if(require('node:fs').readFileSync('/app/uploads/smoke.txt','utf8')!=='persistent-upload')process.exit(1)"
