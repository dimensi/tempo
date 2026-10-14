// Each isolated browser process has its own local HTTPS gateway.
export const testOrigin = process.env.CI_E2E_ORIGIN ?? 'https://localhost:3160';
const origin = new URL(testOrigin);
if (
  origin.protocol !== 'https:' ||
  origin.hostname !== 'localhost' ||
  ![3160, 3260, 3262].includes(Number(origin.port)) ||
  origin.username ||
  origin.password ||
  origin.pathname !== '/' ||
  origin.search ||
  origin.hash
)
  throw new Error(
    'E2E origin must be one of the disposable local HTTPS gateways',
  );
