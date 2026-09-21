ARG WEB_BASE_IMAGE=node:22-bookworm-slim
FROM ${WEB_BASE_IMAGE} AS base
WORKDIR /app
RUN if ! command -v python3 >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1 || ! command -v openssl >/dev/null 2>&1; then apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates python3 curl && rm -rf /var/lib/apt/lists/*; fi
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

FROM deps AS app
ENV DATABASE_URL=postgresql://saas:saas@postgres:5432/listing?schema=public
COPY . .
RUN pnpm db:generate
RUN pnpm --filter @saas/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@saas/web", "start"]
