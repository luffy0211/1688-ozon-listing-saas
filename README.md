# 1688 → Ozon 自动上架 SaaS

中文后台网站，服务跨境卖家：通过浏览器插件采集 1688 商品页和店铺列表，翻译/本地化成俄文资料，生成 Ozon 上架草稿，点击"运行并上架"后自动提交到客户自己的 Ozon 店铺。

> 完整产品与实现方案见 [方案.md](./方案.md)。本仓库第一版先本地 Docker 部署跑通闭环，后续迁移到云服务器。参考仓库仅借鉴流程，未复用其源码。

## 技术栈

- Next.js App Router + TypeScript + Tailwind + shadcn/ui
- PostgreSQL + Prisma
- Redis + BullMQ
- MinIO（S3 兼容对象存储）
- pnpm workspace
- Vitest + Playwright

## 目录结构

```text
apps/web        Next.js 中文后台
apps/worker     BullMQ 后台任务（15 步上架流水线）
apps/extension  Chrome/Edge MV3 采集插件
packages/db     Prisma schema + 加密
packages/core   商品标准化、定价、校验
packages/ozon   Ozon client + payload 编译 + mock + 门禁
packages/xiangji 象寄翻译 + PDP 详情图
packages/storage S3/MinIO 存储
```

## 快速开始

### 环境要求

- Node.js 20+、pnpm 9+
- Docker + Docker Compose（本地跑数据库/缓存/存储/服务）

### 一键启动

```bash
# 1. 准备环境变量
cp .env.example .env
# 生成密钥
#   SESSION_SECRET:      openssl rand -hex 32
#   APP_ENCRYPTION_KEY:  openssl rand -base64 32

# 2. 安装依赖并生成 Prisma Client
pnpm install
pnpm db:generate

# 3. 启动（含数据库迁移）
docker compose up --build
```

访问：

- Web：http://localhost:3000
- MinIO Console：http://localhost:9001

### 本地开发（不用 Docker 跑 web/worker）

```bash
docker compose up -d postgres redis minio   # 只起基础设施
pnpm db:migrate
pnpm dev:web      # 终端 1
pnpm dev:worker   # 终端 2
```

### 测试

```bash
pnpm test        # 单测
pnpm test:e2e    # Playwright E2E
```

## 关键安全开关

- `ENABLE_REAL_OZON_SUBMIT=false`（默认）：只打 mock Ozon，绝不调用真实 Ozon 创建/更新接口。真实提交必须显式设为 `true`。
- Ozon API Key、象寄 X-API-Key 均 AES-256-GCM 加密存储，API 只返回脱敏值。
- Ozon payload 永远不包含库存字段；已有 `ozon_task_id` 时禁止重复提交。

## 许可

本仓库未复用参考项目源码，仅借鉴其公开流程。参考项目及许可：

- https://github.com/jlcglobal/jlc-global-ozon-auto-listing
- https://github.com/jlcglobal/jlc-global-ozon-auto-listing/blob/main/LICENSE
