// Injected only by connection-ui.test.ts into its disposable Next.js child process.
// Mock the OAuth wire response; the actual vendored SDK still performs the exchange.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const bodyControlPath = resolve('.data/e2e-yazio-body-control.json');
const bodyStatePath = resolve('.data/e2e-yazio-body-state.json');
let bodyState = {
  runId: '',
  entries: {},
  reads: 0,
  creates: 0,
  updates: 0,
  lost: false,
  version: 0,
};
function bodyControl() {
  try {
    return JSON.parse(readFileSync(bodyControlPath, 'utf8'));
  } catch {
    return null;
  }
}
function saveBodyState() {
  writeFileSync(bodyStatePath, JSON.stringify(bodyState), { mode: 0o600 });
}
const expected = {
  BETTER_AUTH_URL: 'https://localhost:3160',
  BETTER_AUTH_SECRET: 'offline-production-synthetic-secret-1234567890',
};
if (
  process.env.NODE_ENV !== 'production' ||
  process.env.CI_SYNTHETIC_PROVIDER !== 'yazio'
)
  throw new Error(
    'Only isolated synthetic production YAZIO tests may load this fixture',
  );
for (const [key, value] of Object.entries(expected))
  if (process.env[key] !== value)
    throw new Error('Unsafe synthetic YAZIO environment');
const root = process.cwd();
if (
  !['file:./.data/e2e.sqlite', `file:${root}/.data/e2e.sqlite`].includes(
    process.env.DATABASE_URL,
  )
)
  throw new Error('Only the disposable E2E database is allowed');
if (
  process.env.YAZIO_TOKEN_FILE !== `${root}/.data/e2e-yazio-connection.json` &&
  !(
    process.env.YAZIO_TOKEN_FILE === '' &&
    process.env.CI_YAZIO_UNCONFIGURED === 'true'
  )
)
  throw new Error('Only the disposable YAZIO token store is allowed');
if (process.env.YAZIO_ACCESS_TOKEN || process.env.YAZIO_REFRESH_TOKEN)
  throw new Error('Inherited provider credentials forbidden');
let initialFailuresRemaining = 0;
let backfillDelay = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === 'string' || input instanceof URL ? input : input.url,
  );
  if (
    url.hostname === 'yzapi.yazio.com' &&
    url.pathname === '/v22/oauth/token'
  ) {
    const body = JSON.parse(init?.body ?? '{}');
    if (
      ![
        'synthetic-yazio@example.test',
        'synthetic-fail-sync@example.test',
        'synthetic-close-browser@example.test',
      ].includes(body.username) ||
      body.password !== 'Synthetic-YAZIO-password-only'
    )
      return Response.json({ error: 'synthetic rejection' }, { status: 401 });
    backfillDelay =
      body.username === 'synthetic-close-browser@example.test' ? 500 : 0;
    initialFailuresRemaining =
      body.username === 'synthetic-fail-sync@example.test' ? 12 : 0;
    return Response.json({
      token_type: 'Bearer',
      access_token: 'synthetic-ui-access-only',
      refresh_token: 'synthetic-ui-refresh-only',
      expires_in: 3600,
    });
  }
  if (url.hostname === 'yzapi.yazio.com') {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (headers.get('authorization') !== 'Bearer synthetic-ui-access-only')
      throw new Error('Only synthetic YAZIO authorization is allowed');
    if (url.pathname.includes('/user/bodyvalues')) {
      const control = bodyControl();
      if (control) {
        if (bodyState.runId !== control.runId)
          bodyState = {
            runId: control.runId,
            entries: {},
            reads: 0,
            creates: 0,
            updates: 0,
            lost: false,
            version: 0,
          };
        if (control.version !== bodyState.version) {
          for (const [id, value] of Object.entries(control.remoteUpdates ?? {}))
            for (const entries of Object.values(bodyState.entries))
              for (const entry of entries)
                if (entry.id === id) entry.value = value;
          bodyState.version = control.version;
        }
      }
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        bodyState.reads++;
        saveBodyState();
        if (control?.mode === 'outage')
          return Response.json(
            { error: 'synthetic body unavailable' },
            { status: 502 },
          );
        if (url.pathname.endsWith('/bodyvalues'))
          return Response.json(
            Object.fromEntries(
              Object.entries(bodyState.entries).map(([key, entries]) => [
                key,
                entries.filter(
                  (entry) =>
                    entry.date.slice(0, 10) === url.searchParams.get('date'),
                ),
              ]),
            ),
          );
        if (url.pathname.endsWith('/weight/last')) return Response.json(null);
        return Response.json([]);
      }
      if (!control)
        throw new Error('Synthetic body writes need explicit fixture control');
      if (method === 'POST' && url.pathname.endsWith('/bodyvalues')) {
        const groups = JSON.parse(init.body);
        for (const [key, entries] of Object.entries(groups))
          for (const entry of entries) {
            if (!bodyState.entries[key]) bodyState.entries[key] = [];
            const existing = bodyState.entries[key].find(
              (row) => row.id === entry.id,
            );
            if (existing) Object.assign(existing, entry);
            else bodyState.entries[key].push(entry);
          }
        bodyState.creates++;
        saveBodyState();
        if (control.mode === 'post_lost' && !bodyState.lost) {
          bodyState.lost = true;
          saveBodyState();
          return Response.json(
            { error: 'synthetic response lost' },
            { status: 502 },
          );
        }
        return new Response(null, { status: 204 });
      }
      if (method === 'PUT') {
        const id = url.pathname.split('/').at(-1),
          body = JSON.parse(init.body);
        for (const entries of Object.values(bodyState.entries))
          for (const entry of entries)
            if (entry.id === id) entry.value = body.value;
        bodyState.updates++;
        saveBodyState();
        return new Response(null, { status: 204 });
      }
      throw new Error('Unexpected synthetic body write method');
    }
    if (url.pathname.endsWith('/user'))
      return Response.json({
        email: 'synthetic-yazio@example.test',
        first_name: 'Synthetic',
        last_name: 'YAZIO',
        profile_image: 'https://images.yazio-cdn.com/synthetic-avatar.png',
        user_token: 'synthetic-private-profile-token',
      });
    if (
      initialFailuresRemaining > 0 &&
      (url.pathname.endsWith('/user/consumed-items') ||
        url.pathname.endsWith('/user/widgets/daily-summary') ||
        url.pathname.includes('/user/meal-images/'))
    ) {
      initialFailuresRemaining--;
      return Response.json(
        { error: 'synthetic initial loading failure' },
        { status: 502 },
      );
    }
    if (url.pathname.endsWith('/user/consumed-items')) {
      if (backfillDelay)
        await new Promise((resolve) => setTimeout(resolve, backfillDelay));
      return Response.json({
        products: [],
        recipe_portions: [],
        simple_products: [],
      });
    }
    if (url.pathname.endsWith('/user/widgets/daily-summary'))
      return Response.json({
        meals: Object.fromEntries(
          ['breakfast', 'lunch', 'dinner', 'snack'].map((meal) => [
            meal,
            { nutrients: {} },
          ]),
        ),
      });
    if (url.pathname.includes('/user/meal-images/')) return Response.json({});
  }
  if (url.hostname.endsWith('.yazio.com') || url.hostname === 'yazio.com')
    return Response.json(
      { error: 'unexpected synthetic upstream call' },
      { status: 502 },
    );
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('External network forbidden in synthetic YAZIO runtime');
  return originalFetch(input, init);
};
