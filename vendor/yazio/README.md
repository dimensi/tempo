# Vendored YAZIO SDK

Runtime package for `@dimensi/yazio`, pinned to upstream [dimensi/yazio commit f0013b35de5cb5c9705995612cef6465dde78efc](https://github.com/dimensi/yazio/tree/f0013b35de5cb5c9705995612cef6465dde78efc). Root dependency is `file:vendor/yazio`; no npm publication or floating Git ref is used. The exact upstream has no declared license; this package does not invent one.

## Contents and provenance

`upstream-source.tar.gz` contains byte-for-byte Git blobs for all SDK `src/**/*.ts` plus the six mocked tests in `tests/meal-images.test.ts` and `tests/consumed-time.test.ts`. It excludes live-auth tests, credentials, environment files, research, private fixtures and data. The deterministic tar/gzip archive uses sorted paths, zero timestamps/UID/GID and fixed modes. `source-checksums.json` lists SHA-256 of each blob; `provenance.json` pins the repository, commit, archive checksum and build procedure. `artifact-checksums.json` covers every generated ESM/CJS/declaration file.

Only packaging changes: scoped private metadata, real build entrypoints instead of nonexistent `src/types.ts`, explicit type export conditions, auth type reexports and shared-module wrappers. The pinned v2 source preserves explicit local diary timestamps; packaging does not rewrite runtime behavior. Root and `/auth` share their YazioAuth class within each module format. `/api` retains upstream exports. Internal `sdk` is not a public package subpath; its fetch helper is exported only for the upstream mocked header test.

`zod@3.25.76` is an exact SDK dependency, isolated from application Zod 4. Runtime installation needs committed package metadata/dist and the normal frozen root lockfile. It never downloads upstream source, runs build tools, uses postinstall or performs authentication. Offline installation assumes the root application dependencies, including Zod 3, are already in the pnpm store; a wholly empty offline machine cannot install Next.js either.

## Rebuild

From the repository root, with Node 22:

```sh
npm ci --prefix vendor/yazio/toolchain --ignore-scripts
node vendor/yazio/build.mjs
```

The toolchain package/lock pin tsup 8.5.0, TypeScript 5.9.3, Prettier 3.9.10, Node types 22.20.5 and Zod 3.25.76; transitive dependencies are integrity-pinned in its lockfile. The builder extracts and validates original blobs into a disposable temporary directory. It bundles one SDK module in ESM/CJS plus both declaration formats, then writes thin public wrappers. File-location comments normalize temporary paths to `upstream/`; no runtime statements are rewritten. Repeated builds must leave `dist` and `artifact-checksums.json` byte-identical. Build tools are not needed in application/Docker installation.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run tests/unit/sdk-artifact.test.ts
node vendor/yazio/smoke.mjs
```

The five SDK-A tests use mocked fetch against the installed artifact: v20 meal images/auth headers, empty and invalid responses, header merging, v22 login/refresh and rejected-refresh credential fallback. Additional tests cover ESM/CJS subpaths, class identity, existing facade methods and artifact checksums. The smoke script resolves the installed package from the current repository/application directory and performs only mocked requests with synthetic tokens.

Docker copies package/dist before frozen install and explicitly retains package/dist with nested Zod 3 in the final non-root runtime. This preserves availability before real consumer routes enter Next tracing. A runtime check without network can be run after building:

```sh
docker build -t nutrition-sdk-artifact .
docker run --rm --network none --entrypoint node -v "$PWD/vendor/yazio/smoke.mjs:/app/sdk-smoke.mjs:ro" nutrition-sdk-artifact /app/sdk-smoke.mjs
```

No live YAZIO authentication, publication, production mutation or deployment is part of this packaging task.
