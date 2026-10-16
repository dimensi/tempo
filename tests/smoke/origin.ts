const origin = new URL(process.env.CI_E2E_ORIGIN ?? 'https://localhost:3260');

if (
  origin.protocol !== 'https:' ||
  origin.hostname !== 'localhost' ||
  origin.username ||
  origin.password ||
  origin.pathname !== '/' ||
  origin.search ||
  origin.hash ||
  !Number.isInteger(Number(origin.port)) ||
  Number(origin.port) < 3260 ||
  Number(origin.port) > 3290 ||
  Number(origin.port) % 2 !== 0
)
  throw new Error('E2E origin must be a disposable local HTTPS gateway');

export const testOrigin = origin.toString().slice(0, -1);
export const testBackendPort = Number(
  process.env.CI_E2E_BACKEND_PORT ?? Number(origin.port) + 1,
);

if (testBackendPort !== Number(origin.port) + 1)
  throw new Error('E2E backend must follow its HTTPS gateway');
