import 'dotenv/config';
import { resolve, sep } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import { symmetricEncrypt } from 'better-auth/crypto';
import { getDatabase } from '@/server/db';
import { readServerEnv } from '@/server/env';
import {
  oauthClient,
  oauthClientResource,
  oauthResource,
} from '@/server/db/schema/oauth';

const [command, value, destination] = process.argv.slice(2);
try {
  if (command === 'create') {
    const callback = new URL(z.url().parse(value));
    if (
      callback.protocol !== 'https:' ||
      callback.username ||
      callback.password ||
      callback.hash
    )
      throw new Error('HTTPS callback required');
    const path = resolve(z.string().min(1).parse(destination));
    const env = readServerEnv();
    const unsafePaths = [resolve('public'), resolve(env.UPLOADS_DIR)];
    if (
      unsafePaths.some(
        (directory) => path === directory || path.startsWith(directory + sep),
      )
    )
      throw new Error('Private output required');
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // Open before issuance so an existing output can never leave an unrecorded client.
    const { openSync, closeSync } = await import('node:fs');
    const fd = openSync(path, 'wx', 0o600);
    let saved = false;
    try {
      if (!env.BETTER_AUTH_SECRET) throw new Error('Secret required');
      const client = {
        client_id: randomUUID(),
        client_secret: randomBytes(32).toString('base64url'),
      };
      const encrypted = await symmetricEncrypt({
        key: env.BETTER_AUTH_SECRET,
        data: client.client_secret,
      });
      const resource = new URL('/api/mcp', env.BETTER_AUTH_URL).href;
      const { db, sqlite } = getDatabase();
      // Local operator bootstrap, with fixed policy; no bootstrap HTTP endpoint or session.
      sqlite.transaction(() => {
        db.insert(oauthResource)
          .values({
            id: randomUUID(),
            identifier: resource,
            name: 'Tempo',
            allowedScopes: ['tempo:read', 'offline_access'],
          })
          .onConflictDoNothing()
          .run();
        db.insert(oauthClient)
          .values({
            id: randomUUID(),
            clientId: client.client_id,
            clientSecret: encrypted,
            name: 'Tempo AI',
            redirectUris: [callback.href],
            scopes: ['tempo:read', 'offline_access'],
            grantTypes: ['authorization_code', 'refresh_token'],
            responseTypes: ['code'],
            tokenEndpointAuthMethod: 'client_secret_post',
            requirePKCE: true,
            skipConsent: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .run();
        db.insert(oauthClientResource)
          .values({
            id: randomUUID(),
            clientId: client.client_id,
            resourceId: resource,
            createdAt: new Date(),
          })
          .run();
        writeFileSync(fd, JSON.stringify(client, null, 2));
      })();
      saved = true;
    } finally {
      closeSync(fd);
      if (!saved) rmSync(path);
    }
    console.log(
      'OAuth client saved in private output file. Do not share or commit it.',
    );
  } else if (command === 'revoke') {
    const id = z.string().min(1).max(256).parse(value);
    const result = getDatabase()
      .db.update(oauthClient)
      .set({ disabled: true })
      .where(eq(oauthClient.clientId, id))
      .run();
    if (!result.changes) throw new Error('Unknown client');
    console.log(
      'OAuth client disabled; access and refresh tokens are no longer accepted.',
    );
  } else
    throw new Error(
      'Usage: mcp-client create <https-callback> <private-output.json> | revoke <client-id>',
    );
} catch {
  console.error(
    'MCP client operation failed. Check command, callback, output path and database configuration.',
  );
  process.exitCode = 1;
} finally {
  getDatabase().sqlite.close();
}
