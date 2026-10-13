import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('manual full regression cannot export a deployable artifact or auto-start CD', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const cd = readFileSync('.github/workflows/cd.yml', 'utf8');
  assert.match(ci, /push:\s+branches: \[main\]/);
  assert.doesNotMatch(ci, /pull_request:|schedule:/);
  for (const step of ['Export tested release image', 'nutrition-release-']) {
    const position = ci.indexOf(step);
    assert.ok(position > 0);
    assert.match(
      ci.slice(Math.max(0, position - 160), position + 180),
      /if: github.event_name == 'push' && github.ref == 'refs\/heads\/main'/,
    );
  }
  assert.match(cd, /github.event.workflow_run.event == 'push'/);
  assert.match(
    cd,
    /assert run\['event'\] == 'push' and run\['head_branch'\] == 'main'/,
  );
  assert.match(cd, /for name in \('checks', 'docker'\)/);
  assert.match(
    cd,
    /m\['revision'\] == os.environ\['REVISION'\] and m\['tree'\]/,
  );
});
