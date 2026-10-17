FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
FROM base AS dependencies
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml .npmrc ./
COPY vendor/yazio/package.json ./vendor/yazio/package.json
COPY vendor/yazio/dist ./vendor/yazio/dist
RUN pnpm install --frozen-lockfile
FROM dependencies AS builder
COPY . .
RUN pnpm build && node scripts/build-cli.mjs
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 DATABASE_URL=file:/app/data/nutrition.sqlite UPLOADS_DIR=/app/uploads PLAYWRIGHT_BROWSERS_PATH=/ms-playwright PDF_FONT_PATH=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/dist-cli ./scripts
# Keep a canonical SDK directory regardless of Next tracing/symlink output.
RUN rm -rf ./node_modules/@dimensi/yazio
COPY --from=builder --chown=node:node /app/vendor/yazio/package.json ./node_modules/@dimensi/yazio/package.json
COPY --from=builder --chown=node:node /app/vendor/yazio/dist ./node_modules/@dimensi/yazio/dist
COPY --from=builder --chown=node:node /app/node_modules/.pnpm/zod@3.25.76/node_modules/zod ./node_modules/@dimensi/yazio/node_modules/zod
# Keep locked Playwright packages/CLI available before report routes are merged/traced.
RUN rm -rf ./node_modules/@playwright/test ./node_modules/playwright ./node_modules/playwright-core
COPY --from=builder --chown=node:node /app/node_modules/.pnpm/@playwright+test@1.64.0/node_modules/@playwright/test ./node_modules/@playwright/test
COPY --from=builder --chown=node:node /app/node_modules/.pnpm/playwright@1.64.0/node_modules/playwright ./node_modules/playwright
COPY --from=builder --chown=node:node /app/node_modules/.pnpm/playwright-core@1.64.0/node_modules/playwright-core ./node_modules/playwright-core
COPY --from=builder --chown=node:node /app/scripts/pdf-runtime-smoke.mjs ./scripts/pdf-runtime-smoke.mjs
RUN node node_modules/playwright-core/cli.js install --with-deps chromium \
    && apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && chown -R node:node /ms-playwright
RUN mkdir -p /app/data /app/uploads && chown node:node /app/data /app/uploads
USER node
COPY --from=builder --chown=node:node /app/vendor/yazio/smoke.mjs /tmp/yazio-sdk-smoke.mjs
RUN --network=none node /tmp/yazio-sdk-smoke.mjs && rm /tmp/yazio-sdk-smoke.mjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node server.js"]
