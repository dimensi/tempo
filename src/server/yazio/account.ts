import 'server-only';
import { getUser } from '@dimensi/yazio/api';
import type { Token } from '@dimensi/yazio/auth';
import { z } from 'zod';
import { yazioRequest } from './client';

import type { YazioAccount } from '@/contracts/nutrition-sync';
const profileSchema = z.object({
  email: z.email().max(254),
  first_name: z.string().max(100),
  last_name: z.string().max(100),
  profile_image: z.url().optional(),
});
const shared = globalThis as typeof globalThis & {
  yazioAccountCache?: Map<string, YazioAccount>;
};
const cache = (shared.yazioAccountCache ??= new Map());
export const getYazioAccount = (ownerId: string) => cache.get(ownerId) ?? null;
export const clearYazioAccount = (ownerId: string) => {
  cache.delete(ownerId);
};
export function cacheYazioAccount(ownerId: string, account: YazioAccount) {
  cache.clear(); // The supported application has exactly one OWNER.
  cache.set(ownerId, account);
}
export async function readYazioAccount(
  token: Token,
  submittedEmail?: string,
): Promise<YazioAccount> {
  try {
    // Confirmed SDK API: getUser(token) -> /user. Never refresh or expose its raw payload.
    const raw = profileSchema.parse(await yazioRequest(() => getUser(token)));
    let avatar: string | null = null;
    if (raw.profile_image) {
      const url = new URL(raw.profile_image);
      if (
        url.protocol === 'https:' &&
        url.hostname === 'images.yazio-cdn.com' &&
        !url.username &&
        !url.password
      ) {
        url.search = '';
        url.hash = '';
        avatar = url.toString();
      }
    }
    return {
      email: raw.email,
      name: [raw.first_name, raw.last_name].filter(Boolean).join(' ') || null,
      avatar,
    };
  } catch {
    // Submitted YAZIO email is a display fallback, never the application's OWNER identity.
    return { email: submittedEmail ?? null, name: null, avatar: null };
  }
}
