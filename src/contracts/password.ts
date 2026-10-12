import { z } from 'zod';
export const passwordLimits = { min: 8, max: 128 } as const;
// App account creation only; provider credentials and existing hashes are unchanged.
export const newPasswordSchema = z
  .string()
  .min(passwordLimits.min)
  .max(passwordLimits.max);
