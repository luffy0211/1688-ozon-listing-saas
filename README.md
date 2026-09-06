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

- Node.js 22+、pnpm 9+
- Docker + Docker Compose（本地跑数据库/缓存/存储/服务）

### 一键启动

```bash
# 1. 准备环境变量（本机已创建 .env；新机器按需复制）
cp .env.example .env
# 生成密钥
#   SESSION_SECRET:      openssl rand -hex 32
#   APP_ENCRYPTION_KEY:  openssl rand -base64 32

# 2. 安装依赖并生成 Prisma Client
pnpm install
pnpm db:generate

# 3. 启动（web 容器会自动 db push + seed）
docker compose up --build
```

访问：

- Web：http://localhost:3000
- MinIO Console：http://localhost:9001

本地 seed 默认账号：

- 管理员：`admin@example.com`
- 密码：`Admin123456`
- 注册邀请码：`dev-invite`

### 本地开发（不用 Docker 跑 web/worker）

```bash
docker compose up -d postgres redis minio   # 只起基础设施
pnpm db:push
pnpm db:seed
pnpm dev:web      # 终端 1
pnpm dev:worker   # 终端 2
```

### 浏览器插件

```bash
pnpm --filter @saas/extension build
```

在 Chrome/Edge 打开扩展管理页，启用开发者模式，加载：

```text
apps/extension/dist
```

插件默认把数据提交到 `http://localhost:3000`，采集前需要先在后台登录。

### 测试

```bash
pnpm test        # 单测
pnpm test:e2e    # Playwright E2E
```

### Ozon 运营 Agent

```bash
OPENAI_API_KEY=               # 真实调用 OpenAI Agents SDK 时填写
OPENAI_AGENT_MODEL=           # 为空时使用 Agents SDK 默认模型
OPENAI_AGENT_MOCK=true        # 本地演示默认走 mock；设为 false 后调用 OpenAI
OPENAI_AGENT_TRACE_SENSITIVE_DATA=false
AGENT_MIN_MARGIN_RATE=0.25
AGENT_MIN_PROFIT_RUB=100
AGENT_COMPETITOR_CACHE_HOURS=24
TAVILY_API_KEY=              # 竞品搜索，仅服务端使用
```

后台入口：`/agent`。统一 Agent 支持店铺诊断、竞品分析和 Ozon 活动查询。竞品分析默认读取最近 30 天销量前 5 个商品，并通过 Tavily 查找 Ozon 公开商品页。

活动报名先在对话中提交自然语言 SOP，Agent 会生成受限规则等待确认；规则生效后才能生成报名动作。报名动作执行前会重新读取活动、候选商品、价格和库存，且单次最多 20 个商品。

## 关键安全开关

- `ENABLE_REAL_OZON_SUBMIT=false`（默认）：只打 mock Ozon，绝不调用真实 Ozon 创建/更新接口。真实提交必须显式设为 `true`。
- 活动报名和商品修改共用上述开关，并且必须经过 Agent 动作确认；模型不能直接调用写接口。
- Ozon API Key、象寄 X-API-Key 均 AES-256-GCM 加密存储，API 只返回脱敏值。
- Ozon payload 永远不包含库存字段；已有 `ozon_task_id` 时禁止重复提交。

## 许可

本仓库未复用参考项目源码，仅借鉴其公开流程。参考项目及许可：

- https://github.com/jlcglobal/jlc-global-ozon-auto-listing
- https://github.com/jlcglobal/jlc-global-ozon-auto-listing/blob/main/LICENSE
