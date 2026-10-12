import 'server-only';
import {
  createTransformMateClient,
  type TransformMateClient,
} from '@/server/transformmate/client';
import { FirebaseSession } from '@/server/transformmate/firebase-session';

let client: TransformMateClient | undefined;
export function isTransformMateConfigured() {
  return Boolean(
    process.env.TRANSFORMMATE_FIREBASE_API_KEY?.trim() &&
    process.env.TRANSFORMMATE_FIREBASE_REFRESH_TOKEN?.trim(),
  );
}
export function getTransformMateClient(): TransformMateClient | null {
  if (!isTransformMateConfigured()) return null;
  return (client ??= createTransformMateClient({
    baseUrl: 'https://transformmate.pht.space/ipt/api/v1',
    tokenProvider: new FirebaseSession({
      firebaseApiKey: process.env.TRANSFORMMATE_FIREBASE_API_KEY!,
      refreshToken: process.env.TRANSFORMMATE_FIREBASE_REFRESH_TOKEN!,
    }),
  }));
}
