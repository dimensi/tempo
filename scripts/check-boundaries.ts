import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const failures: string[] = [];
function walk(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (/\.tsx?$/.test(path)) {
      const text = readFileSync(path, 'utf8');
      const ownFeature = path.match(/^src\/features\/([^/]+)\//)?.[1];
      for (const match of text.matchAll(
        /(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g,
      )) {
        const target = match[1]!;
        if (
          ownFeature &&
          target.startsWith('@/features/') &&
          target.split('/')[2] !== ownFeature
        )
          failures.push(
            `${path}: features cannot depend on another feature (${target})`,
          );
        if (
          !path.startsWith('src/server/') &&
          (target.includes('/server/') ||
            target === '@dimensi/yazio' ||
            target.startsWith('@dimensi/yazio/'))
        )
          failures.push(`${path}: server imports must stay in src/server`);
      }
      if (/['"]use client['"]/.test(text) && /@\/server\//.test(text))
        failures.push(`${path}: client/server boundary violated`);
      if (
        !path.startsWith('src/lib/demo/') &&
        /@\/lib\/demo/.test(text) &&
        path !== 'src/server/demo.ts'
      )
        failures.push(
          `${path}: fixtures must go through the server demo guard`,
        );
    }
  }
}
// App Router may call the server layer; feature UI must never import it.
walk('src/features');
walk('src/components');
walk('src/lib');
walk('src/contracts');
walk('src/config');
if (failures.length) throw new Error(failures.join('\n'));
console.log('Feature and server boundaries checked');
