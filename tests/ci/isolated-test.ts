import { test as base, expect } from '@playwright/test';
import { relative, resolve } from 'node:path';
export * from '@playwright/test';
// Automatic fixture runs before page/context use and user beforeEach hooks.
// The gateway is test-only and loopback; production has no reset endpoint.
export const test = base.extend<{ _isolatedCase: void }>({
  _isolatedCase: [
    async ({ request }, use, info) => {
      if (process.env.CI_E2E_WORKER === 'true') {
        const reset = await request.post('/__offline-test/reset', {
          data: {
            caseKey: [
              relative(resolve('tests'), info.file),
              info.line,
              info.title,
              info.project.name,
            ],
          },
        });
        expect(
          reset.status(),
          'Fresh isolated production server and fixture',
        ).toBe(200);
        expect((await reset.json()).generation).toBeGreaterThan(0);
        await reset.dispose();
      }
      await use();
    },
    { auto: true },
  ],
});
