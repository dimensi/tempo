import { z } from 'zod';
const schema = z.object({
  DATABASE_URL: z
    .string()
    .startsWith('file:')
    .default('file:./.data/development.sqlite'),
  BETTER_AUTH_URL: z.url().default('http://localhost:3000'),
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  ENABLE_NUTRITION_SCHEDULER: z.enum(['true', 'false']).default('false'),
  YAZIO_TOKEN_FILE: z.string().optional(),
  TRANSFORMMATE_TOKEN_FILE: z
    .string()
    .default('./.data/private/transformmate-token.json'),
  UPLOADS_DIR: z.string().default('./.data/uploads'),
});
export function readServerEnv(input: NodeJS.ProcessEnv = process.env) {
  const env = schema.parse(
    Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        value === '' ? undefined : value,
      ]),
    ),
  );
  if (
    input.NODE_ENV === 'production' &&
    input.NEXT_PHASE !== 'phase-production-build'
  ) {
    if (!env.BETTER_AUTH_SECRET || !env.BETTER_AUTH_URL.startsWith('https://'))
      throw new Error(
        'Production requires a strong BETTER_AUTH_SECRET and HTTPS BETTER_AUTH_URL',
      );
    if (env.DEMO_MODE === 'true')
      throw new Error('Demo mode is forbidden in production');
  }
  return env;
}
