import 'dotenv/config';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { probeTransformMate } from '@/server/transformmate/probe';
import { createProbeSession, reportProbeError } from './transformmate-session';

try {
  const session = createProbeSession();
  await session.getIdToken();
  console.log('Firebase token refresh: OK');
  console.log(`expiresIn: ${session.getSessionInfo()?.expiresIn} seconds`);
  const result = await probeTransformMate({
    tokenProvider: session,
    log: console.log,
    raw: process.argv.includes('--raw'),
  });
  console.log(
    `refreshTokenRotated: ${session.getSessionInfo()?.refreshTokenRotated ?? false}`,
  );
  if (process.argv.includes('--save') && result.trainings?.isJson) {
    await mkdir('.tmp', { recursive: true, mode: 0o700 });
    const path = '.tmp/transformmate-trainings.json';
    await writeFile(
      path,
      `${JSON.stringify(result.trainings.body, null, 2)}\n`,
      { mode: 0o600 },
    );
    await chmod(path, 0o600);
    console.log(`Saved ${path} (secrets redacted).`);
  }
  if (
    !result.trainings ||
    result.trainings.status < 200 ||
    result.trainings.status >= 300
  )
    process.exitCode = 1;
} catch (error) {
  reportProbeError(error);
}
