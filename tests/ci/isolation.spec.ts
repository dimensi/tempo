import { test, expect } from './isolated-test';
import Database from 'better-sqlite3';
import { testOrigin } from './origin';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';

for (const label of ['first', 'second', 'third', 'fourth']) {
  test(`isolated fixture mutations and real auth quota: ${label}`, async ({
    request,
  }) => {
    const login = await request.post('/api/auth/sign-in/email', {
      headers: { origin: testOrigin },
      data: {
        email: 'owner@example.test',
        password: 'Test-only-password-12345',
      },
    });
    expect(login.status()).toBe(200);
    const session = await request.get('/api/auth/get-session');
    expect(session.status()).toBe(200);
    const owner = (await session.json()).user.id as string;
    const db = new Database('.data/e2e.sqlite', { fileMustExist: true });
    try {
      // Both processes use the same primary key and paths. A shared database or
      // private store makes these assertions fail instead of hiding the collision.
      expect(
        db.prepare('SELECT count(*) AS count FROM measurements').get(),
      ).toEqual({ count: 0 });
      db.prepare(
        'INSERT INTO measurements(id,owner_id,measured_at,values_json,note) VALUES(?,?,?,?,?)',
      ).run(
        'isolation-collision',
        owner,
        '2026-01-01',
        JSON.stringify([{ metric: 'weight', value: '80', unit: 'kg' }]),
        label,
      );
      expect(existsSync('.data/e2e-transformmate-token.json')).toBe(false);
      expect(existsSync('.data/e2e-nutrition-uploads/isolation.txt')).toBe(
        false,
      );
      writeFileSync('.data/e2e-transformmate-token.json', label);
      mkdirSync('.data/e2e-nutrition-uploads', { recursive: true });
      writeFileSync('.data/e2e-nutrition-uploads/isolation.txt', label);
      await new Promise((done) => setTimeout(done, 500));
      expect(readFileSync('.data/e2e-transformmate-token.json', 'utf8')).toBe(
        label,
      );
      expect(
        readFileSync('.data/e2e-nutrition-uploads/isolation.txt', 'utf8'),
      ).toBe(label);
      const records = await request.get(`/api/measurements?ownerId=${owner}`);
      expect(records.status()).toBe(200);
      expect(JSON.stringify(await records.json())).toContain(label);
      // An untouched process gets the full real 30-request window. No waits or
      // modified security settings: request 31 must receive the genuine 429.
      for (let index = 1; index < 30; index++) {
        const response = await request.get('/api/auth/get-session');
        expect(response.status(), `fresh session request ${index + 1}`).toBe(
          200,
        );
        await response.dispose();
      }
      const limited = await request.get('/api/auth/get-session');
      expect(limited.status()).toBe(429);
      expect(
        limited.headers()['x-retry-after'] ?? limited.headers()['retry-after'],
      ).toMatch(/^\d+(?:\.\d+)?$/);
    } finally {
      db.close();
    }
  });
}
