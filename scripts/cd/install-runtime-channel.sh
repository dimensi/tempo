#!/usr/bin/env bash
# Run once from a reviewed, hash-verified bundle while CD submissions are paused.
# No recreate, image load, data migration, auth rotation or privilege changes.
set -euo pipefail
set +x
umask 077
[[ "$EUID" == 0 && "$#" == 0 ]] || exit 2
source_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)
[[ "$(stat -c '%u' "$source_dir")" == 0 ]]
permissions=$(stat -c '%a' "$source_dir")
[[ $(( 8#$permissions & 022 )) == 0 ]]
[[ "$(stat -c '%u' "$0")" == 0 && ! -L "$0" ]]
project=/opt/compose/yazio-dashboard
cd "$project"
exec 9>verification/rollout.lock
flock -n 9
compose() { docker compose -p nutrition --env-file runtime.env --env-file release.env -f compose.yaml -f compose.home.yaml "$@"; }
container=$(compose ps -q app)
[[ -n "$container" ]]
[[ "$(docker inspect "$container" --format '{{.State.Health.Status}}')" == healthy ]]
backup=$(mktemp -d verification/runtime-channel-install.XXXXXXXX)
chmod 700 "$backup"
declare -a targets=(/usr/local/libexec/nutrition-cd /usr/local/libexec/nutrition-upgrade-ci-release /usr/local/libexec/nutrition-runtime-config.py "$project/compose.yaml" "$project/compose.home.yaml")
declare -a sources=("$source_dir/nutrition-cd.py.candidate" "$source_dir/upgrade-ci-release.sh.candidate" "$source_dir/nutrition-runtime-config.py" "$source_dir/compose.yaml" "$source_dir/compose.home.yaml")
for index in "${!sources[@]}"; do
 [[ -f "${sources[$index]}" && ! -L "${sources[$index]}" ]]
 [[ "$(stat -c '%u' "${sources[$index]}")" == 0 ]]
 permissions=$(stat -c '%a' "${sources[$index]}")
 [[ $(( 8#$permissions & 022 )) == 0 ]]
 target=${targets[$index]}
 [[ ! -L "$target" ]]
 if [[ -e "$target" ]]; then cp -p -- "$target" "$backup/$index"; else touch "$backup/$index.absent"; fi
done
# Protected local recovery only: never echo, parse or transmit the auth value.
[[ -f runtime.env && ! -L runtime.env ]]
cp -p runtime.env "$backup/runtime.env"
chmod 600 "$backup/runtime.env"
armed=true
recover() {
 status=$?
 trap - EXIT
 if [[ "$armed" == true ]]; then
  restore_failed=false
  for index in "${!targets[@]}"; do
   rm -f -- "${targets[$index]}.runtime-channel-new" || restore_failed=true
   if [[ -f "$backup/$index.absent" ]]; then rm -f -- "${targets[$index]}" || restore_failed=true;
   else cp -p -- "$backup/$index" "${targets[$index]}" || restore_failed=true; fi
  done
  if [[ "$restore_failed" == true ]]; then
   echo "ATTENTION: installation and file restoration failed; keep CD paused; protected recovery directory: $backup" >&2
  else
   echo 'Runtime channel installation failed; previous files restored; container was not recreated.' >&2
  fi
  [[ "$status" != 0 ]] || status=1
 fi
 exit "$status"
}
trap recover EXIT
for index in "${!sources[@]}"; do
 mode=755
 [[ "$index" -lt 3 ]] || mode=644
 target=${targets[$index]}
 # Rename on the target filesystem; the lock excludes active receivers.
 install -o root -g root -m "$mode" -- "${sources[$index]}" "$target.runtime-channel-new"
 mv -f -- "$target.runtime-channel-new" "$target"
done
compose config --quiet
cmp --silent runtime.env "$backup/runtime.env"
[[ "$(compose ps -q app)" == "$container" ]]
[[ "$(docker inspect "$container" --format '{{.State.Health.Status}}')" == healthy ]]
armed=false
echo "Runtime channel installed without recreate; protected recovery directory: $backup"
