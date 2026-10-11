import 'dotenv/config';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { probeTransformMate } from '@/server/transformmate/probe';
import { createProbeSession, reportProbeError } from './transformmate-session';

try {
  const idArgument = process.argv.indexOf('--training-id');
  const trainingId =
    idArgument < 0 ? undefined : Number(process.argv[idArgument + 1]);
  if (
    trainingId !== undefined &&
    (!Number.isSafeInteger(trainingId) || trainingId <= 0)
  ) {
    throw new Error('Invalid TransformMate training ID');
  }
  const session = createProbeSession();
  await session.getIdToken();
  console.log('Firebase token refresh: OK');
  console.log(`expiresIn: ${session.getSessionInfo()?.expiresIn} seconds`);
  const result = await probeTransformMate({
    tokenProvider: session,
    log: console.log,
    raw: process.argv.includes('--raw'),
    trainingId,
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
  if (process.argv.includes('--save') && result.detail?.isJson) {
    const path = `.tmp/transformmate-training-${trainingId}.json`;
    await mkdir('.tmp', { recursive: true, mode: 0o700 });
    await writeFile(path, `${JSON.stringify(result.detail.body, null, 2)}\n`, {
      mode: 0o600,
    });
    await chmod(path, 0o600);
    console.log(`Saved ${path} (secrets redacted).`);
  }
  if (
    !result.trainings ||
    result.trainings.status < 200 ||
    result.trainings.status >= 300 ||
    (result.detail !== null &&
      (result.detail.status < 200 || result.detail.status >= 300))
  )
    process.exitCode = 1;
} catch (error) {
  reportProbeError(error);
}
