import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
  mkdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(root, 'toolchain/package.json'));
const ts = require('typescript');
const { format } = require('prettier');
const { build } = require('tsup');
const originalDirectory = process.cwd();
const work = await mkdtemp(join(tmpdir(), 'yazio-package-'));
const hash = (data) => createHash('sha256').update(data).digest('hex');
const checksums = JSON.parse(
  await readFile(join(root, 'source-checksums.json'), 'utf8'),
);
try {
  const provenance = JSON.parse(
    await readFile(join(root, 'provenance.json'), 'utf8'),
  );
  if (
    hash(await readFile(join(root, 'upstream-source.tar.gz'))) !==
    provenance.upstreamTree.archiveSha256
  )
    throw new Error('Source archive checksum mismatch');
  execFileSync('tar', [
    '-xzf',
    join(root, 'upstream-source.tar.gz'),
    '-C',
    work,
  ]);
  for (const [name, expected] of Object.entries(checksums)) {
    if (hash(await readFile(join(work, name))) !== expected)
      throw new Error(`Source checksum mismatch: ${name}`);
  }
  await symlink(
    join(root, 'toolchain/node_modules'),
    join(work, 'node_modules'),
  );
  await writeFile(
    join(work, 'package.json'),
    JSON.stringify({ type: 'module', dependencies: { zod: '3.25.76' } }),
  );
  await writeFile(
    join(work, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: { '@/*': ['src/*'] },
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        lib: ['ESNext', 'DOM'],
        strict: true,
        skipLibCheck: true,
      },
    }),
  );
  await writeFile(
    join(work, 'sdk.ts'),
    "export * from '@/index';\nexport * from '@/auth';\nexport * from '@/api';\nexport type * from '@/types/auth';\nexport { fetchYazio } from '@/utils/fetch';\n",
  );
  process.chdir(work);
  await build({
    entry: ['sdk.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    target: 'node22',
    outDir: join(work, 'dist'),
    clean: true,
    banner: { js: '/* eslint-disable */' },
  });
  process.chdir(originalDirectory);
  const source = ts.createSourceFile(
    'api.ts',
    await readFile(join(work, 'src/api.ts'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const values = [],
    types = [];
  for (const statement of source.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements)
        (statement.isTypeOnly || element.isTypeOnly ? types : values).push(
          element.name.text,
        );
    }
  }
  const typeNames = [
    'Token',
    'Credentials',
    'TokenResolver',
    'CredentialsResolver',
    'RefreshHandler',
    'YazioAuthInit',
  ];
  const entryExports = {
    index: ['Yazio', 'YazioAuth'],
    auth: ['YazioAuth'],
    api: values,
  };
  const output = join(root, 'dist');
  await mkdir(output, { recursive: true });
  for (const name of await readdir(join(work, 'dist'))) {
    const content =
      (name.includes('.d.') ? '/* eslint-disable */\n' : '') +
      (await readFile(join(work, 'dist', name), 'utf8')).replace(
        /^\/\/ .*?yazio-package-[^/]+\/(src\/\S+|sdk\.ts)$/gm,
        '// upstream/$1',
      );
    await writeFile(
      join(output, name),
      await format(content, {
        filepath: name,
        singleQuote: true,
        trailingComma: 'all',
      }),
    );
  }
  for (const [entry, names] of Object.entries(entryExports)) {
    const named = names.join(', ');
    await writeFile(
      join(output, `${entry}.js`),
      await format(`export { ${named} } from './sdk.js';\n`, {
        filepath: 'entry.js',
        singleQuote: true,
      }),
    );
    await writeFile(
      join(output, `${entry}.cjs`),
      await format(
        `/* eslint-disable */\nconst sdk = require('./sdk.cjs');\n${names.map((name) => `exports.${name} = sdk.${name};`).join('\n')}\n`,
        { filepath: 'entry.cjs', singleQuote: true },
      ),
    );
    for (const [extension, target] of [
      ['d.ts', 'sdk.js'],
      ['d.cts', 'sdk.cjs'],
    ]) {
      const exportedTypes = entry === 'api' ? types : typeNames;
      const declaration = `export { ${named} } from './${target}';\nexport type { ${exportedTypes.join(', ')} } from './${target}';\n`;
      await writeFile(
        join(output, `${entry}.${extension}`),
        await format(declaration, {
          filepath: 'entry.d.ts',
          singleQuote: true,
        }),
      );
    }
  }
  const artifacts = {};
  for (const name of (await readdir(output)).sort())
    artifacts[`dist/${name}`] = hash(await readFile(join(output, name)));
  await writeFile(
    join(root, 'artifact-checksums.json'),
    await format(JSON.stringify(artifacts), { parser: 'json' }),
  );
} finally {
  process.chdir(originalDirectory);
  await rm(work, { recursive: true, force: true });
}
