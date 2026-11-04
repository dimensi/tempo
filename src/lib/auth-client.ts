import { createAuthClient } from 'better-auth/react';
export const authClient = createAuthClient({
  fetchOptions: {
    onRequest(context) {
      // Deferred renewal needs a JSON body when sent through the HTTP handler.
      if (
        context.method === 'POST' &&
        new URL(context.url).pathname === '/api/auth/get-session'
      ) {
        context.headers.set('Content-Type', 'application/json');
        context.body = '{}';
      }
    },
  },
  sessionOptions: { refetchInterval: 60 * 60 },
});
