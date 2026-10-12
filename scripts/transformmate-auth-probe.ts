import 'dotenv/config';
import { createProbeSession, reportProbeError } from './transformmate-session';

try {
  const session = createProbeSession();
  await session.getIdToken();
  const info = session.getSessionInfo();
  console.log('Firebase refresh: OK');
  console.log(`expiresIn: ${info?.expiresIn} seconds`);
  console.log(`userId: ${info?.userId}`);
  console.log(`projectId: ${info?.projectId}`);
  console.log(`refreshTokenRotated: ${info?.refreshTokenRotated ?? false}`);
} catch (error) {
  reportProbeError(error);
}
