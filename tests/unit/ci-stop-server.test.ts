import { test, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { stopServer } from '../ci/stop-server';
test('reset waits for an uncooperative disposable server to exit after bounded TERM then KILL', async () => {
  const child = spawn(process.execPath, [
    '-e',
    "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},100)",
  ]);
  try {
    await once(child.stdout!, 'data');
    await stopServer(child, 25, 1000);
    expect(child.signalCode).toBe('SIGKILL');
    expect(() => process.kill(child.pid!, 0)).toThrow();
  } finally {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL');
  }
});
test('reset handles a server that has already exited', async () => {
  const child = spawn(process.execPath, ['-e', '']);
  await once(child, 'exit');
  await stopServer(child, 25, 1000);
  expect(child.exitCode).toBe(0);
});
