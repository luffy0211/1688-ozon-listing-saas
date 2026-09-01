# AGENTS.md

本文件是面向 AI/协作代理的项目说明。改动前先读本文件。

## 仓库概览

`1688-ozon-listing-saas` 是 pnpm workspace 单仓，把 1688 商品采集并自动上架到 Ozon。

- `apps/web` — Next.js App Router 中文后台（认证、租户隔离、API、页面）。
- `apps/worker` — BullMQ 后台任务，跑商品上架流水线（15 步）。
- `apps/extension` — Chrome/Edge MV3 采集插件，采 1688 单商品 / 店铺列表。
- `packages/db` — Prisma schema + 客户端 + 加密工具。
- `packages/core` — 商品标准化、定价、校验（纯函数，无副作用）。
- `packages/ozon` — Ozon API client、payload 编译、mock、提交门禁。
- `packages/xiangji` — 象寄文本翻译 + PDP 详情图 client。
- `packages/1688` — 1688 接口采集（mtop 签名、扫码登录、店铺列表、商品详情）。
- `packages/storage` — S3/MinIO 对象存储。

## 常用命令

```bash
pnpm install                 # 安装所有依赖
pnpm db:generate             # 生成 Prisma Client
pnpm db:migrate              # 创建迁移（dev）
pnpm build                   # 构建 web/worker/packages
pnpm test                    # Vitest 单测
pnpm test:e2e                # Playwright E2E（需本地服务）
pnpm typecheck               # 类型检查
docker compose up --build    # 本地一键起 postgres/redis/minio/web/worker
```

## 关键约定

1. **租户隔离是硬约束**：所有业务表必须有 `tenant_id`，所有查询必须按 `tenant_id` 过滤。任何 SQL/Prisma 查询漏掉 `tenant_id` 都是 bug。
2. **密钥不落明文**：Ozon API Key、象寄 X-API-Key 用 AES-256-GCM 加密保存，API 只返回脱敏值。
3. **Ozon 提交门禁**：`ENABLE_REAL_OZON_SUBMIT=false` 时只能走 mock，绝不调真实 Ozon。提交前必须过 `packages/ozon` 里的硬门禁（缺密钥/主图/详情图/价格、payload 含库存字段、重复 request_hash 都禁止）。
4. **禁止提交库存字段**：任何 Ozon payload 不得出现库存/仓库相关字段。
5. **估算必须标注**：`product_facts` 里估算字段带 `estimated: true` 和置信度；不得虚构材质/认证/承重/品牌/功能/配件数量；品牌默认"无品牌"。
6. **翻译结果不直接当 Ozon 文案**：必须先经 Ozon 内容编译和长度校验。
7. **raw_json 不被覆盖**：`source_products.raw_json`、`source_shops.raw_json` 保存原始采集，只追加/更新快照，不重写。
8. **响应格式**：成功 `{ "data": {} }`，失败 `{ "error": { "code", "message", "details" } }`。
9. 环境变量命名见 `.env.example`；`.env` 不入库。
10. 新增表先改 `packages/db/prisma/schema.prisma` 再 `pnpm db:generate`。
11. 1688 采集走服务端接口（`packages/1688`）：登录态加密存 `source1688_credentials`，cookie 不落日志、API 不返回明文；店铺采集 `POST /api/v1/shops/import-by-url`、单商品 `POST /api/v1/products/import-by-url`，采集合同复用 `SourceShopImport`/`SourceProductImport`（不新增合同类型）。

## 测试

- 纯逻辑（定价、payload 编译、门禁、标准化、加密、去重/新品判定）放 Vitest 单测。
- E2E 用 Playwright，覆盖：邀请码注册/登录、店铺采集、商品运行、查看提交结果。
- 改门禁或 payload 编译必须跑对应单测。
