import { createServer } from 'node:net';

// Dedicated loopback gateway/backend pairs, separate from provider ports.
export const gatewayPorts = Array.from({ length: 16 }, (_, i) => 3260 + i * 2);
export const upstreamPort = (gateway) => 3360 + (gateway - 3260) / 2;

async function available(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

export async function selectGateways(count) {
  const selected = [];
  for (const gateway of gatewayPorts) {
    if (
      (await available(gateway)) &&
      (await available(gateway + 1)) &&
      (await available(upstreamPort(gateway)))
    )
      selected.push(gateway);
    if (selected.length === count) return selected;
  }
  throw new Error(
    `Need ${count} free isolated E2E port groups; found ${selected.length}. No serial fallback; never stop unrelated processes.`,
  );
}
