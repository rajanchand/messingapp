# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/automation/package.json packages/automation/
COPY packages/database/package.json packages/database/
COPY packages/auth/package.json packages/auth/
COPY packages/security/package.json packages/security/
COPY packages/matrix/package.json packages/matrix/
COPY workers/automation/package.json workers/automation/
RUN pnpm install --frozen-lockfile

FROM deps AS runner
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY workers/automation/ workers/automation/

ENV NODE_ENV=production

WORKDIR /app/workers/automation
CMD ["pnpm", "start"]
