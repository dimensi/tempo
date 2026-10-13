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
  ENABLE_ANAMNESIS_WORKER: z.enum(['true', 'false']).default('false'),
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).max(32).default('us-east-1'),
  S3_BUCKET: z.string().min(1).max(63).default('apps'),
  S3_ACCESS_KEY_ID: z.string().min(1).max(128).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).max(128).optional(),
  ANAMNESIS_LLM_BASE_URL: z
    .url()
    .default('https://api.z.ai/api/coding/paas/v4'),
  ANAMNESIS_LLM_API_KEY: z.string().min(1).max(256).optional(),
  ANAMNESIS_LLM_MODEL: z.string().min(1).max(64).default('glm-4.5v'),
  ANAMNESIS_LLM_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5000)
    .max(300000)
    .default(120000),
  ANAMNESIS_IMPORT_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(104857600)
    .default(26214400),
  ANAMNESIS_IMPORT_MAX_PAGES: z.coerce
    .number()
    .int()
    .min(1)
    .max(500)
    .default(100),
  // Тестовый провайдер распознавания: отвечает только на файл с точным sha256.
  ANAMNESIS_EXTRACTION_FIXTURE_SHA256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
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
