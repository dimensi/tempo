#!/usr/bin/env bash
set -euo pipefail
# Called only after the CI Docker smoke step succeeds.
[[ "${GITHUB_EVENT_NAME:-}" == push && "${GITHUB_REF:-}" == refs/heads/main ]] || {
  echo 'Release export requires a main push.' >&2
  exit 1
}
revision=$(git rev-parse HEAD)
[[ "$revision" == "${GITHUB_SHA:-}" ]] || { echo 'Checkout SHA mismatch.' >&2; exit 1; }
tree=$(git rev-parse 'HEAD^{tree}')
[[ "$(docker image inspect nutrition-foundation --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')" == "$revision" ]] || { echo 'Image revision mismatch.' >&2; exit 1; }
[[ "$(docker image inspect nutrition-foundation --format '{{ index .Config.Labels "org.opencontainers.image.tree" }}')" == "$tree" ]] || { echo 'Image tree mismatch.' >&2; exit 1; }
image_tag="nutrition-release:${revision:0:12}"
image_id=$(docker image inspect nutrition-foundation --format '{{.Id}}')
docker tag "$image_id" "$image_tag"
mkdir release-artifact
docker image save "$image_tag" | gzip > release-artifact/image.tar.gz
archive_sha256=$(sha256sum release-artifact/image.tar.gz | cut -d ' ' -f 1)
printf '{"revision":"%s","tree":"%s","imageTag":"%s","imageId":"%s","archiveSHA256":"%s"}\n' \
  "$revision" "$tree" "$image_tag" "$image_id" "$archive_sha256" > release-artifact/manifest.json
