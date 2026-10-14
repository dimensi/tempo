import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A Linux subreaper retains detached orphans even if their parent exits before
// a polling interval. It reaps the entire owned tree before returning.
export async function runProcessGroup(command, args, options) {
  if (!['linux', 'darwin'].includes(process.platform))
    throw new Error('Isolated browser cleanup supports Linux and macOS');
  if (options.signal?.aborted) throw new Error('Browser run cancelled');
  const child = spawn(
    'python3',
    [
      fileURLToPath(
        new URL(
          process.platform === 'darwin'
            ? './macos-process-supervisor.py'
            : './process-supervisor.py',
          import.meta.url,
        ),
      ),
      command,
      ...args,
    ],
    { cwd: options.cwd, env: options.env, stdio: 'inherit', detached: true },
  );
  const abort = () => {
    try {
      child.kill('SIGTERM');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    return await new Promise((done, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (signal)
          reject(new Error(`Browser supervisor terminated by ${signal}`));
        else if (code === 125)
          reject(new Error('Owned browser process tree did not terminate'));
        else done(code);
      });
    });
  } finally {
    options.signal?.removeEventListener('abort', abort);
    if (options.signal?.aborted) throw new Error('Browser run cancelled');
  }
}
