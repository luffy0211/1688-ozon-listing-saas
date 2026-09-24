# Ozon diagnosis data TDD evidence

Source plan: `C:\Users\郭雷A\Desktop\Ozon-Agent全面修复执行方案-2026-09-24.md`, items 6 and 8.

User journeys:

- A seller sees the real Seller API image count and description in competitor comparison.
- A seller sees unavailable or partial order data when FBS/FBO reads fail, instead of false zeroes.

| Guarantee | Test | RED evidence | GREEN evidence |
|---|---|---|---|
| Seller API multi-image and description data survives analytics and competitor-report mapping | `packages/ozon/src/analytics.test.ts`, `apps/web/src/lib/agent/operations.test.ts` | Received one image and `description: null`; `hydrateOwnProductTargets` was absent | Full image list and direct/attribute 4191 descriptions pass |
| Failed FBS/FBO reads remain nullable and carry per-channel status | `packages/ozon/src/analytics-unknown.test.ts` | Failed reads returned `0` | Partial/unavailable status and nullable totals pass |
| Agent diagnosis does not report failed reads as zero or calculate false growth | `apps/web/src/lib/agent/operations.test.ts` | Partial read produced order count `2` | Order count/revenue/growth remain `null` |
| Unread own images and descriptions are displayed as unavailable | `apps/web/src/components/agent-insight-panel.test.ts` | UI rendered `自家无图` | UI renders `图片暂未获取` / `暂未获取简介` |

Validation:

- `pnpm test`: 54 files passed; 334 passed, 2 skipped.
- `pnpm typecheck`: all workspace typechecks passed.
- `pnpm --filter @saas/web build`: passed. Build logged expected missing `DATABASE_URL` messages during static data collection; no database was connected or modified.
- `pnpm audit --prod`: no known vulnerabilities.

Known gap: no live Ozon API, PostgreSQL, paid collection, or browser session was used. Local tests use mocks; the user can validate real connected-store rendering after merging the dependent PR chain.
