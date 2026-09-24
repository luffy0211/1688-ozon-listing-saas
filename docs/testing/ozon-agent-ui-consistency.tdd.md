# Ozon agent UI consistency TDD evidence

Source plan: `C:\Users\郭雷A\Desktop\Ozon-Agent全面修复执行方案-2026-09-24.md`, items 9-11.

| Guarantee | Test | RED evidence | GREEN evidence |
|---|---|---|---|
| Reloading a conversation resumes its persisted run instead of starting a new one | `apps/web/src/app/api/v1/agent/content/sessions/[id]/messages/route.test.ts`, `apps/web/src/components/content-agent-chat.test.ts` | History exposed no unfinished run; four new UI regression tests failed | History returns the unresolved run and the UI recognizes its runId and trace |
| A local edit is never presented as approved or executed content from another tab | `apps/web/src/components/content-agent-chat.test.ts` | Non-pending actions rendered the component's stale local `edits` state | Non-pending or version-changed actions render the server payload and show a conflict notice |
| A late delete response cannot switch a newer session or clear its input | `apps/web/src/components/content-agent-chat.test.ts` | Archive completion used the request-time session list and selection | Archive completion uses latest refs and only switches when the archived session is still selected |
| Queued action execution does not freeze batch review | `apps/web/src/components/content-agent-chat.test.ts` | Action refresh was absent; the first implementation awaited up to 120 seconds | Accepted commands return immediately and a cancellable background poll refreshes stable action state |

Validation:

- `pnpm test`: 55 files passed; 341 passed, 2 skipped.
- `pnpm -r typecheck`: all workspace typechecks passed.
- `pnpm --filter @saas/web build`: passed. Static generation logged the expected missing `DATABASE_URL`; no database was connected or modified.
- `pnpm audit --prod`: no known vulnerabilities.

Coverage output was not generated because the repository does not install `@vitest/coverage-v8`; no dependency was added for this repair. No PostgreSQL, live Ozon API, paid collection, or real mutation was used.
