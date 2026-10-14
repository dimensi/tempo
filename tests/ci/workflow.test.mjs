import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('manual full regression cannot publish an image or auto-start CD', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const cd = readFileSync('.github/workflows/cd.yml', 'utf8');
  assert.match(ci, /push:\s+branches: \[main\]/);
  assert.doesNotMatch(ci, /pull_request:|schedule:/);
  const publish = ci.slice(ci.indexOf('- name: Publish tested image to GHCR'));
  assert.match(
    publish,
    /if: github.event_name == 'push' && github.ref == 'refs\/heads\/main'/,
  );
  assert.match(publish, /docker tag nutrition-foundation/);
  assert.match(publish, /docker push "\$image"/);
  assert.doesNotMatch(ci, /export-release-artifact|nutrition-release-/);
  assert.match(cd, /github.event.workflow_run.event == 'push'/);
  assert.match(
    cd,
    /assert run\['event'\] == 'push' and run\['head_branch'\] == 'main'/,
  );
  assert.match(cd, /for name in \('checks', 'docker'\)/);
  assert.match(cd, /scp -P 2224/);
  assert.match(cd, /compose_stage pull app/);
  assert.match(cd, /up -d --no-build --wait --wait-timeout 120 app/);
  assert.match(cd, /exec 9>verification\/rollout.lock/);
  assert.doesNotMatch(
    cd,
    /nutrition-release |download-artifact|nutrition-upgrade-ci-release/,
  );
});
