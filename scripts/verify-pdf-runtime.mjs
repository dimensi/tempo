import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const file = process.argv[2];
assert.ok(file, 'Pass the synthetic runtime PDF');
const run = (tool, args) => execFileSync(tool, args, { encoding: 'utf8' });
assert.match(
  run('pdfinfo', [file]),
  /Page size:\s+59[45]\.\d+ x 841\.\d+ pts \(A4\)/,
);
assert.match(run('pdffonts', [file]), /(?:DejaVuSans|Arial).*yes\s+yes\s+yes/);
const text = run('pdftotext', ['-layout', file, '-']);
for (const value of ['Дневник питания', 'Синтетические данные', 'Яйцо'])
  assert.ok(text.includes(value), `Missing Cyrillic text: ${value}`);
assert.equal(text.split('\f').filter((page) => page.trim()).length, 1);
const bbox = run('pdftotext', ['-bbox', file, '-']);
for (const match of bbox.matchAll(
  /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"/g,
)) {
  assert.ok(
    Number(match[1]) >= 30 &&
      Number(match[2]) >= 30 &&
      Number(match[3]) <= 565 &&
      Number(match[4]) <= 810,
    'PDF text clipped outside A4 margins',
  );
}
console.log(
  'PDF A4 geometry, embedded Cyrillic font and extracted text passed',
);
