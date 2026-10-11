import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { openDatabase } from '../src/server/db/connection';
import { user, account, trainerAccess } from '../src/server/db/schema';
const input = z
  .object({
    email: z.email(),
    name: z.string().min(1),
    role: z.enum(['OWNER', 'TRAINER']),
    password: z.string().min(12).max(128),
  })
  .parse({
    email: process.env.CREATE_USER_EMAIL,
    name: process.env.CREATE_USER_NAME,
    role: process.env.CREATE_USER_ROLE ?? 'OWNER',
    password: process.env.CREATE_USER_PASSWORD,
  });
const { db, sqlite } = openDatabase(
  process.env.DATABASE_URL ?? 'file:./.data/development.sqlite',
);
try {
  const password = await hashPassword(input.password);
  const id = randomUUID();
  const now = new Date();
  db.transaction((tx) => {
    tx.insert(user)
      .values({
        id,
        name: input.name,
        email: input.email.toLowerCase(),
        role: input.role,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.insert(account)
      .values({
        id: randomUUID(),
        accountId: id,
        providerId: 'credential',
        userId: id,
        password,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    if (input.role === 'TRAINER' && process.env.GRANT_OWNER_ACCESS === 'true') {
      const owner = tx.select().from(user).where(eq(user.role, 'OWNER')).get();
      if (!owner)
        throw new Error('Create owner before granting trainer access');
      tx.insert(trainerAccess)
        .values({ trainerId: id, ownerId: owner.id, createdAt: now })
        .run();
    }
  });
  console.log(`Created ${input.role}; no credentials printed`);
} finally {
  sqlite.close();
}
