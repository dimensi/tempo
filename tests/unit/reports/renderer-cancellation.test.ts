import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  pdf: vi.fn(),
  content: vi.fn(),
  ready: null as null | (() => void),
}));
vi.mock('server-only', () => ({}));
vi.mock('@playwright/test', () => ({
  chromium: {
    launch: async () => ({
      close: state.close,
      newContext: async () => ({
        newPage: async () => ({
          setViewportSize: async () => {},
          context: () => ({ route: async () => {} }),
          setContent: () => {
            state.ready?.();
            return new Promise(() => {});
          },
          pdf: state.pdf,
          content: state.content,
        }),
      }),
    }),
  },
}));
import { renderReport } from '@/server/pdf/renderer';
it('aborting a preview closes its browser promptly without producing PDF or HTML bytes', async () => {
  const controller = new AbortController();
  let prepared!: () => void;
  const preparing = new Promise<void>((resolve) => {
    prepared = resolve;
  });
  state.ready = prepared;
  const result = renderReport('<html></html>', 'html', controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  await preparing;
  controller.abort();
  await rejected;
  expect(state.close).toHaveBeenCalledOnce();
  expect(state.pdf).not.toHaveBeenCalled();
  expect(state.content).not.toHaveBeenCalled();
});
