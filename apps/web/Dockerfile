FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/extension/package.json apps/extension/package.json
COPY packages/1688/package.json packages/1688/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/ozon/package.json packages/ozon/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/xiangji/package.json packages/xiangji/package.json
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @saas/web exec playwright install --with-deps chromium

FROM deps AS app
ENV DATABASE_URL=postgresql://saas:saas@postgres:5432/listing?schema=public
COPY . .
RUN pnpm db:generate
RUN pnpm --filter @saas/web build
EXPOSE 3000
CMD ["sh", "-c", "pnpm db:push && pnpm --filter @saas/web start"]
