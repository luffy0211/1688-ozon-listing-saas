# Local Agent Commercial-Readiness Fixes

## Recovery and GitHub Handoff: 2026-10-07

This section supersedes the historical runtime and dependency-audit status below.
It is a code handoff, not a production deployment or a claim that live operations
have passed end to end.

### Recovered Code

- The former Temp worktree had an invalid Git reference and 319 of 320 tracked
  files were missing. Its surviving Git objects recovered the complete `af9a887`
  tree and history into a separate, non-Temp checkout. `git fsck --full
  --no-reflogs` passes without using the old object's directory.
- The surviving old tracked file matched the recovered commit. No additional
  uncommitted source files survived in that worktree. The original directories
  were not overwritten; the cause of the file loss was not established.
- Earlier features already have open PRs through #19. The remaining work is
  separated into the following dependent branches, retaining the original
  commits without merging or rebasing:

| Review Order | Branch | Scope |
| --- | --- | --- |
| After #19 | `fix/tenant-auth-hardening` | Tenant/session validation and login limits (`ddfab1d`) |
| Next | `fix/agent-durable-execution` | Persisted jobs, write verification and billing safeguards (`2d7ebfa`) |
| Next | `feat/local-competitor-comparison` | Inline comparison, exact draft links and targeted refresh (`af9a887`) |
| Last | `fix/production-dependency-security` | Security patches and this handoff |

The last branch contains the complete combined code. Review the dependency chain
before merging; do not deploy an intermediate branch with the old dependency lock.
No `.env`, API keys, cookies, database contents, logs or generated build output are
part of the upload. A targeted credential-pattern scan found no matches in the
59 newly changed Agent files; this is not a comprehensive historical secret audit.

### Dependency Security

The initial audit found one critical and three high vulnerabilities. The updated
lock now resolves Next.js 16.3.6, source-map-js 1.2.2, sharp 0.35.5 and MCP client
2.2.0 (including its matching core dependency), within existing transitive ranges.
React and the OpenAI Agents SDK versions are unchanged.

- [Next.js ImageResponse advisory](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j)
- [source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)
- [sharp advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w)
- [MCP client advisory](https://github.com/advisories/GHSA-6qxp-vccf-f47h)

### Verification Repeated on the Patched Version

- `pnpm install --frozen-lockfile --ignore-scripts`: pass.
- `pnpm test`: 72 files passed; 660 tests passed, 2 skipped.
- `pnpm typecheck`: pass across the workspace.
- `pnpm build`: extension, Web and worker pass. The Web build still reports
  missing `DATABASE_URL` and Prisma tracing/CommonJS warnings.
- `pnpm audit --prod --audit-level high`: no known vulnerabilities reported.
- Isolated production HTTP smoke: `/login` returns 200, unauthenticated
  `/agent/content` redirects with 307, and `/api/v1/stores/ozon` returns 401.
  The temporary smoke-test server was stopped afterwards.
- No paid collection, live model call, real Ozon write, database migration, seed,
  import or restart was performed. Browser evidence below is from September 28,
  not a newly repeated authenticated browser journey. Coverage was not measured.

### Current Local Runtime Is Not Fully Restored

The old port-3000 service still listened but `/login` returned HTTP 500 on October 7.
Listening PostgreSQL/Redis ports do not establish database health or data recovery;
neither database contents nor credentials were inspected during this handoff.
The recovered checkout has no private runtime environment. Reconfigure approved
local credentials before claiming the full Agent workflow is available.

For a later local restart, use the project's existing scripts and a privately
supplied `.env` or inherited environment. Preserve the encryption key used by
existing store credentials. Keep `ENABLE_REAL_OZON_SUBMIT=false` and use the same
isolated `AGENT_QUEUE_NAME` in Web and worker. Inspect old queues before starting
the full worker, because its `listing` queue is shared. Do not run seed, db push or
migrations as an automatic startup step. Fresh Apify collection needs a valid
operator token; real Ozon mutation tests require separate explicit approval.

## Historical Verification: 2026-09-28

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

## Inline Competitor Comparison (Local Only)

- The conversation now compares actual main images, titles, prices, keywords and
  descriptions. Category/product selectors and competitor thumbnails expose every
  returned sample, without the former four-category/six-competitor display limits.
- Full descriptions are additive to legacy summaries. Unknown values remain unknown;
  extracted terms are not official tags, and reviews are not sales. Vision advice is
  attached only to the corresponding analyzed image, with no added vision calls.
- A pending draft shortcut requires an exact store and offer match. It focuses the
  existing editor without executing or creating another action. Unsupported/missing
  refresh identifiers cannot initiate a broader refresh.
- A targeted refresh reads the explicit own product and confirms its official
  category before collection or billing. Missing/mismatched products or categories
  fail closed; the refresh count is tested against the actual Agent prompt parser.
- Chat updates no longer force scrolling while reading evidence. Native image dialogs
  support Escape and restore focus. Comparison changes preserve existing draft edits.

Run the isolated frontend fixture (no database, Redis, Ozon or collection API):

```powershell
node tools/preview-competitor-ui.mjs
# Open the printed loopback URL, normally http://127.0.0.1:5179/
```

The fixture is explicitly labelled demo data; it is not a production route and does
not insert fake products into any database. Its buttons have local-only callbacks.
Its example product photo is fetched from Unsplash. The Vite server binds to loopback.

Browser regression, with browser-harness attached to an isolated local Chromium:

```powershell
$env:BU_CDP_URL='http://127.0.0.1:9224'
$env:BU_NAME='local-competitor'
$env:PYTHONUTF8='1'
New-Item -ItemType Directory -Path test-results -Force | Out-Null
Get-Content tests/ui/competitor-browser-qa.py -Raw | browser-harness
```

Verified category/competitor selection, description expansion, missing images and
legacy summaries, zoom/Escape/focus restoration, exact draft selection, draft editing
and preservation, and no horizontal overflow at 320/390/768/1440 pixels. Screenshots
are generated under ignored `test-results/`. No live authenticated store execution
was tested. Production build still warns about the missing database configuration;
a successful build does not remove the local test prerequisites above.

Current regression result: 72 files, 660 passed and 2 skipped. Workspace typecheck,
Web production build and the isolated browser journey pass; production dependency
audit reports no known vulnerabilities. Coverage percentage was not measured.
