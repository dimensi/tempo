#!/usr/bin/env bash
set -euo pipefail
set +x
umask 077
phase() { printf '%s\n' "$1" > "$DEPLOY_PHASE_FILE"; }
phase configuration
[[ "$RUN_ID" =~ ^[0-9]+$ && "$REVISION" =~ ^[0-9a-f]{40}$ ]]
[[ "$DEPLOY_HOST" =~ ^[a-zA-Z0-9.-]+$ && "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ && "$DEPLOY_USER" != nutrition-deploy ]]
[[ "$GITHUB_ACTOR" =~ ^[a-zA-Z0-9-]+$ ]]
[[ "$DEPLOY_PORT" =~ ^[0-9]{1,5}$ && "$DEPLOY_PORT" -ge 1 && "$DEPLOY_PORT" -le 65535 ]]
[[ "$DEPLOY_PATH" =~ ^/opt/compose/[a-zA-Z0-9_-]+$ ]]
[[ "$DEPLOY_PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]]
[[ "$DEPLOY_HEALTH_URL" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]{1,5})?/api/health$ ]]
[[ -n "$DEPLOY_KEY" && -n "$KNOWN_HOSTS" && -n "$GH_TOKEN" ]]
phase revision
[[ "$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)" == "$REVISION" ]]
scratch=$(mktemp -d "$RUNNER_TEMP/tempo-deploy.XXXXXX")
deploy_run="$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
[[ "$deploy_run" =~ ^[0-9]+-[0-9]+$ ]]
stage="$DEPLOY_PATH/.deploy-$deploy_run-$REVISION"
dest="$DEPLOY_USER@$DEPLOY_HOST"
printf '%s\n' "$DEPLOY_KEY" > "$scratch/key"
printf '%s\n' "$KNOWN_HOSTS" > "$scratch/hosts"
unset DEPLOY_KEY KNOWN_HOSTS
ssh_args=(-i "$scratch/key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$scratch/hosts" -o BatchMode=yes -o ConnectTimeout=10)
cleanup() {
  ssh -p "$DEPLOY_PORT" "${ssh_args[@]}" "$dest" "rm -rf -- '$stage'" >/dev/null 2>&1 || true
  rm -rf "$scratch"
}
trap cleanup EXIT
phase configuration
export DEPLOY_ENV_PATH="$scratch/.env.deploy"
python3 - <<'PYENV'
import hashlib, hmac, json, os
runtime_keys = ('S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET',
                'ANAMNESIS_LLM_BASE_URL', 'ANAMNESIS_LLM_MODEL',
                'ANAMNESIS_LLM_TIMEOUT_MS', 'ENABLE_ANAMNESIS_WORKER')
keys = (*runtime_keys, 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'OPENROUTER_API_KEY')
values = {key: os.environ[key] for key in keys}
approved = json.dumps({key: values[key] for key in runtime_keys}, sort_keys=True, separators=(',', ':')).encode()
assert hmac.compare_digest(hashlib.sha256(approved).hexdigest(), os.environ['APPROVED_RUNTIME_SHA256']), 'Unapproved runtime setting'
assert all(0 < len(value) <= 2048 and all(32 <= ord(c) <= 126 and c not in "'\\" for c in value) for value in values.values()), 'Invalid runtime setting'
import re
image = os.environ['IMAGE_REF']
assert re.fullmatch(re.escape('ghcr.io/' + os.environ['GITHUB_REPOSITORY'].lower()) + r'@sha256:[0-9a-f]{64}', image), 'Invalid release image'
values.update(NUTRITION_IMAGE=image, DEPLOYED_COMMIT=os.environ['REVISION'])
with open(os.environ['DEPLOY_ENV_PATH'], 'x') as output:
    output.write(''.join(f"{key}='{value}'\n" for key, value in values.items()))
PYENV
printf '%s' "$GH_TOKEN" > "$scratch/registry-token"
unset GH_TOKEN S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY OPENROUTER_API_KEY
phase connection
ssh -p "$DEPLOY_PORT" "${ssh_args[@]}" "$dest" "umask 077; test -r '$DEPLOY_PATH/runtime.env' && mkdir -m 700 '$stage'"
phase transfer
scp -P "$DEPLOY_PORT" "${ssh_args[@]}" compose.yaml compose.home.yaml "$scratch/.env.deploy" "$scratch/registry-token" "$dest:$stage/"
phase rollout
ssh -p "$DEPLOY_PORT" "${ssh_args[@]}" "$dest" "bash -s -- '$REVISION' '$deploy_run' '$GITHUB_ACTOR' '$GITHUB_REPOSITORY' '$DEPLOY_PATH' '$DEPLOY_PROJECT' '$DEPLOY_HEALTH_URL'" <<'REMOTE'
set -euo pipefail
set +x
umask 077
revision=$1 run=$2 actor=$3 deploy_path=$5 project=$6 health_url=$7
[[ "$revision" =~ ^[0-9a-f]{40}$ && "$run" =~ ^[0-9]+-[0-9]+$ && "$actor" =~ ^[a-zA-Z0-9-]+$ ]]
cd "$deploy_path"
stage="$PWD/.deploy-$run-$revision"
exec 9>verification/rollout.lock
flock -n 9
old_container=$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter label=com.docker.compose.service=app)
[[ -n "$old_container" && "$old_container" != *$'\n'* ]]
stopped=false
cleanup() {
  status=$?
  trap - EXIT
  if [[ "$stopped" == true ]] && ! docker start "$old_container" >/dev/null; then
    echo 'ATTENTION: old app restart failed; operator action required.' >&2
  fi
  rm -f compose.yaml.new compose.home.yaml.new .env.deploy.new
  rm -rf "$stage"
  exit "$status"
}
trap cleanup EXIT
test -f runtime.env && test -r runtime.env && test ! -L runtime.env
export DOCKER_CONFIG="$stage/docker-config"
mkdir -m 700 "$DOCKER_CONFIG"
docker login ghcr.io -u "$actor" --password-stdin < "$stage/registry-token" >/dev/null
rm "$stage/registry-token"
compose_stage() { docker compose -p "$project" --env-file runtime.env --env-file "$stage/.env.deploy" -f "$stage/compose.yaml" -f "$stage/compose.home.yaml" "$@"; }
pull_image() {
  local attempt pull_status pull_log="$stage/pull.log"
  for attempt in 1 2 3; do
    if compose_stage pull app >"$pull_log" 2>&1; then
      cat "$pull_log"
      return 0
    else
      pull_status=$?
    fi
    cat "$pull_log" >&2
    # Retry transport failures only; authentication/configuration errors fail fast.
    if [[ "$attempt" == 3 ]] || ! grep -Eiq 'TLS handshake timeout|i/o timeout|context deadline exceeded|Client.Timeout exceeded|connection reset by peer|unexpected EOF|net/http: request canceled|502 Bad Gateway|503 Service Unavailable|504 Gateway Timeout' "$pull_log"; then
      return "$pull_status"
    fi
    printf 'Transient image download failure; retry %s/3 in %ss.\n' "$((attempt + 1))" "$((attempt * 5))" >&2
    sleep "$((attempt * 5))"
  done
}
compose_stage config --quiet
pull_image
image=$(sed -n "s/^NUTRITION_IMAGE='\(.*\)'$/\1/p" "$stage/.env.deploy")
[[ "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$revision" ]]
# Use the application's existing online-backup CLI before migrations.
docker exec "$old_container" node scripts/backup.mjs "/app/data/pre-deploy-$run-$revision.sqlite"
if [[ ! -f .env.deploy ]] || ! cmp -s <(sed -n '/^S3_/p' .env.deploy) <(sed -n '/^S3_/p' "$stage/.env.deploy"); then
  old_image=$(docker inspect "$old_container" --format '{{.Image}}')
  stopped=true
  docker stop "$old_container" >/dev/null
  docker run --rm --network none --volumes-from "$old_container:ro" --entrypoint node "$old_image" -e '
    const fs=require("node:fs"),D=require("better-sqlite3");
    const db=new D("/app/data/nutrition.sqlite",{readonly:true,fileMustExist:true});
    const count=db.prepare("SELECT count(*) AS n FROM medical_documents").get().n+db.prepare("SELECT count(*) AS n FROM medical_import_jobs").get().n;db.close();
    function files(p){if(!fs.existsSync(p))return 0;return fs.readdirSync(p,{withFileTypes:true}).reduce((n,e)=>{if(e.isSymbolicLink())throw Error("link");return n+(e.isDirectory()?files(p+"/"+e.name):1);},0);}
    if(count||files("/app/uploads/object-storage")){console.error("Storage switch requires a separate migration plan");process.exit(1);}
  '
fi
# Auth runtime.env and historical release.env remain untouched.
for file in compose.yaml compose.home.yaml .env.deploy; do
  cp "$stage/$file" "$file.new"
  chmod 600 "$file.new"
  mv -f "$file.new" "$file"
done
# Compose may replace the old container and run migrations. From here,
# fail visibly on startup/health errors; never restore a live DB blindly.
stopped=false
docker compose -p "$project" --env-file runtime.env --env-file .env.deploy -f compose.yaml -f compose.home.yaml up -d --no-build --wait --wait-timeout 120 app
current=$(docker compose -p "$project" --env-file runtime.env --env-file .env.deploy -f compose.yaml -f compose.home.yaml ps -q app)
[[ "$(docker inspect "$current" --format '{{.Config.Image}}')" == "$image" ]]
[[ "$(docker inspect "$current" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" == "$revision" ]]
[[ "$(curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' "$health_url")" == 200 ]]
# Prune only this application's unused images, after all health checks pass.
docker image prune --all --force --filter "label=org.opencontainers.image.source=https://github.com/$4"
# Keep recent build cache so routine releases can still reuse layers.
docker builder prune --all --force --filter until=168h
REMOTE
