# Local Agent Commercial-Readiness Fixes

Date: 2026-09-28. Local changes only; no deployment, database migration,
paid collection, or live Ozon write was performed.

## Changes

- Authentication checks current tenant membership and role, validates production
  secrets, uses secure production cookies, and rate-limits login with Redis.
- The obsolete unmetered Agent message endpoint returns authenticated HTTP 410.
- Diagnosis messages and run identifiers are saved before BullMQ dispatch.
  Duplicate dispatch does not repeat billing; interrupted runs are not blindly replayed.
- Explicit stock-only/content/competitor exclusions are enforced before tools run.
  Competitor memory is scoped to the current store, not just the tenant.
- Failed/empty collection categories refund their own credits. Refund totals cannot
  exceed the original debit; refunded debit identifiers cannot fund a new attempt.
- Product/store identifiers are checked before writes. Publishing reserves the
  unique request before submission across Agent, direct API, and listing worker paths.
- Bulk writes persist per-item progress. Ambiguous responses and post-write local
  persistence failures remain pending verification rather than false failure/refund.
- A confirmed, terminal content import may repair its missing approved description
  once via attribute 4191. It does not change other fields or repeat the full import.
- The chat reconnects to persisted runs, retries transient polling failures, and
  stops polling when access is revoked or the conversation is left.

## Verification

```powershell
pnpm exec vitest run
pnpm typecheck
pnpm --filter @saas/worker build
pnpm --filter @saas/web build
pnpm audit --prod --audit-level high
```

- 70 test files: 627 passed, 2 skipped. External services and database calls are mocked.
- Workspace typecheck, worker build, and Web production build pass.
- Production dependency audit reports no known vulnerabilities.
- Local HTTP smoke: login page returns 200; anonymous Agent messages API returns 401.
- No live database, Ozon, Apify, or authenticated browser end-to-end test was run.
  Coverage percentage was not measured; these results do not establish 80% coverage.
- Web build logs existing database configuration warnings and Prisma tracing warnings;
  the build succeeds, but this is not proof of a configured runtime.

## Local Test Prerequisites

The checkout has no local `.env`. PostgreSQL and Redis were not listening during
verification. Do not initialize or migrate a database merely to run this branch.
Use an explicitly approved existing local test database and Redis, then configure
the checkout's environment through the normal private configuration process.

For read-only diagnosis testing, set the same `AGENT_QUEUE_NAME=ozon-agent-local-review`
in Web and worker and leave `ENABLE_REAL_OZON_SUBMIT=false`.
`pnpm --filter @saas/worker start:agent-only` consumes diagnosis jobs only, not listing
or mutation jobs. This intentionally does not prove draft execution. Real writes
require a separately approved test and the regular worker.

Production rollout requires HTTPS for secure cookies, non-default session/encryption
secrets, shared Redis, and Web plus worker deployed together. Existing encrypted
credentials must not be re-keyed without a separate migration plan.

## Remaining Boundaries

- Arbitrary new platform errors are not self-repaired. Unknown/expired results remain
  visible for manual reconciliation; successful or uncertain writes are not replayed.
- A publishing reservation retained after a billing failure requires reconciliation.
- Chinese task-scope guards are conservative, not a general semantic intent parser.
- Logout/password changes do not yet revoke already-issued session tokens.
- Payments, recurring subscriptions, broader cost budgets, and backup/restore drills
  are not implemented by this fix. Do not advertise this branch as fully production-ready.
