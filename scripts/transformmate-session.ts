import { FirebaseSession } from '@/server/transformmate/firebase-session';
import {
  FirebaseRefreshError,
  TransformMateApiError,
  TransformMateResponseError,
} from '@/server/transformmate/errors';

export function createProbeSession() {
  return new FirebaseSession({
    firebaseApiKey: process.env.TRANSFORMMATE_FIREBASE_API_KEY ?? '',
    refreshToken: process.env.TRANSFORMMATE_FIREBASE_REFRESH_TOKEN ?? '',
    onRefreshToken: () => {
      console.log('Firebase refresh token rotated; persistence required');
    },
  });
}

export function reportProbeError(error: unknown) {
  if (error instanceof FirebaseRefreshError) {
    console.error(
      `Firebase refresh: FAILED; status: ${error.status ?? 'unavailable'}; code: ${error.code}`,
    );
  } else if (error instanceof TransformMateApiError) {
    console.error(`TransformMate API: FAILED; status: ${error.status}`);
  } else if (error instanceof TransformMateResponseError) {
    console.error(
      `TransformMate response contract mismatch; status: ${error.status}; endpoint: ${error.endpoint}`,
    );
  } else {
    console.error(
      'TransformMate probe failed (configuration, network, response or file I/O).',
    );
  }
  process.exitCode = 1;
}
