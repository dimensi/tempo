FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
FROM base AS dependencies
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
FROM dependencies AS builder
COPY . .
RUN pnpm build && node scripts/build-cli.mjs && node scripts/copy-native.mjs
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 DATABASE_URL=file:/app/data/nutrition.sqlite UPLOADS_DIR=/app/uploads
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/native-modules ./node_modules
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/dist-cli ./scripts
RUN mkdir -p /app/data /app/uploads && chown node:node /app/data /app/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node server.js"]
