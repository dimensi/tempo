# syntax=docker/dockerfile:1
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
FROM node:22-bookworm-slim AS runtime-dependencies
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 DATABASE_URL=file:/app/data/nutrition.sqlite UPLOADS_DIR=/app/uploads PLAYWRIGHT_BROWSERS_PATH=/ms-playwright PDF_FONT_PATH=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
# Browser/system layers must not depend on application output. BuildKit can build
# this stage alongside Next.js and reuse it when only application code changes.
RUN --mount=type=bind,from=dependencies,source=/app/node_modules/.pnpm/playwright-core@1.64.0/node_modules/playwright-core,target=/tmp/playwright-core \
    node /tmp/playwright-core/cli.js install --with-deps chromium \
    && apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && chown -R node:node /ms-playwright
RUN mkdir -p /app/data /app/uploads && chown node:node /app/data /app/uploads
FROM builder AS artifact
RUN node scripts/prepare-image.mjs
WORKDIR /app/.next/standalone
USER node
RUN --network=none node /app/vendor/yazio/smoke.mjs
FROM runtime-dependencies AS runtime
# Keep the app independent of the browser layer. Numeric ownership avoids
# reading /etc/passwd from the base image; no RUN may follow this linked COPY.
COPY --link --from=artifact --chown=1000:1000 /app/.next/standalone ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node server.js"]
