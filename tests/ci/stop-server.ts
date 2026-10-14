import type { ChildProcess } from 'node:child_process';
export async function stopServer(
  child: ChildProcess,
  graceMs = 1000,
  killMs = 1000,
) {
  await new Promise<void>((done, reject) => {
    let hardTimeout: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      hardTimeout = setTimeout(
        () => reject(new Error('Server did not exit before fixture reset')),
        killMs,
      );
    }, graceMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      clearTimeout(hardTimeout);
      done();
    });
    if (child.exitCode !== null || child.signalCode !== null) {
      clearTimeout(timeout);
      done();
    } else if (!child.kill('SIGTERM')) {
      clearTimeout(timeout);
      reject(new Error('Cannot stop server before reset'));
    }
  });
}
