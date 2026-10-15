// Each isolated browser process has its own local HTTPS gateway.
export const testOrigin = process.env.CI_E2E_ORIGIN ?? 'https://localhost:3160';
const origin = new URL(testOrigin);
if (
  origin.protocol !== 'https:' ||
  origin.hostname !== 'localhost' ||
  ![3160, 3260, 3262, 3264, 3266].includes(Number(origin.port)) ||
  origin.username ||
  origin.password ||
  origin.pathname !== '/' ||
  origin.search ||
  origin.hash
)
  throw new Error(
    'E2E origin must be one of the disposable local HTTPS gateways',
  );

// A third independent port per worker belongs only to the synthetic provider.
export const testUpstreamPort =
  Number(origin.port) === 3160 ? 3158 : 3360 + (Number(origin.port) - 3260) / 2;
export const testUpstreamOrigin = `http://127.0.0.1:${testUpstreamPort}`;
