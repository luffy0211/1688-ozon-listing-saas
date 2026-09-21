FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates python3 curl && rm -rf /var/lib/apt/lists/*
RUN corepack enable
