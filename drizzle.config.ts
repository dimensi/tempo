import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url:
      process.env.DATABASE_URL?.replace(/^file:/, '') ??
      './.data/development.sqlite',
  },
});
