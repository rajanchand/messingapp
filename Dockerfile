# syntax=docker/dockerfile:1

# ============================================================
# Zero Trust Security admin platform - production image
# Multi-stage build: deps -> builder -> runner (default)
# The `migrator` target is used for one-off migration runs.
# ============================================================

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# --- Install dependencies (cached layer) ---
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/admin/package.json apps/admin/
COPY packages/database/package.json packages/database/
COPY packages/auth/package.json packages/auth/
COPY packages/security/package.json packages/security/
COPY packages/matrix/package.json packages/matrix/
RUN pnpm install --frozen-lockfile

# --- Build the Next.js app ---
FROM deps AS builder
COPY tsconfig.base.json turbo.json ./
COPY packages/ packages/
COPY apps/ apps/
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @zts/admin build

# --- One-off migration/seed runner (not exposed to the internet) ---
FROM builder AS migrator
CMD ["sh", "-c", "pnpm --filter @zts/database db:migrate && pnpm --filter @zts/database db:seed"]

# --- Minimal production runtime ---
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/admin/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/admin/public ./apps/admin/public

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "apps/admin/server.js"]
