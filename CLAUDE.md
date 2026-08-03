# 1ma (fork of LibreChat)

## White-Label & Upstream Merge

This repo is a **white-label fork** of [danny-avila/LibreChat](https://github.com/danny-avila/LibreChat), branded as **1ma**. The client must never see "LibreChat" anywhere in the UI.

### Rebranding script

After every upstream merge, run:

```bash
bash scripts/rebrand.sh 1ma
```

The script replaces all user-visible "LibreChat" → "1ma" in:
- All locale files (`client/src/locales/*/translation.json`)
- `client/index.html` (title, meta)
- Docker compose files (container names, MONGO_URI)
- `librechat.example.yaml` (welcome text, Terms of Service, comments)
- `.env.example` (APP_TITLE, MONGO_URI, header, comments)

It is **idempotent** — safe to run multiple times. At the end it audits and exits with error if any user-visible "LibreChat" remains.

**Do NOT replace** "LibreChat" in: code comments/JSDoc, `package.json` URLs, `helm/` charts, `.github/ISSUE_TEMPLATE/`, npm package names (`@librechat/agents`, `librechat-data-provider`), Docker registry URLs (`registry.librechat.ai`), or the config file name `librechat.yaml`.

### Upstream merge procedure

```bash
git fetch upstream
git checkout -b merge/upstream-YYYY-MM-DD
git merge upstream/main
# resolve conflicts (workflows: git rm; locales: accept both sides)
bash scripts/rebrand.sh 1ma
npm install && npm run build && npm run test:client
git commit && git push
# create PR → review → merge to main (does NOT deploy — see "Deployment" below)
```

Upstream remote: `upstream` → `https://github.com/danny-avila/LibreChat.git`

### Fork-specific features (not in upstream)

- **Projects** — ChatGPT-style workspaces with sources (RAG) and instructions
- **Two-tab Model Selector** — Agents | LLM picker with `defaultModel`/`defaultAgentId` config
- **Search Chats popup** — centered search dialog replacing inline SearchBar
- **Inter Variable font** — with Cyrillic + OpenType features
- **Docker entrypoint volume-permission fix** — originally for Railway (now retired), still used on the qsr box

---

## Project Overview

This is a monorepo with the following key workspaces:

| Workspace | Language | Side | Dependency | Purpose |
|---|---|---|---|---|
| `/api` | JS (legacy) | Backend | `packages/api`, `packages/data-schemas`, `packages/data-provider`, `@librechat/agents` | Express server — minimize changes here |
| `/packages/api` | **TypeScript** | Backend | `packages/data-schemas`, `packages/data-provider` | New backend code lives here (TS only, consumed by `/api`) |
| `/packages/data-schemas` | TypeScript | Backend | `packages/data-provider` | Database models/schemas, shareable across backend projects |
| `/packages/data-provider` | TypeScript | Shared | — | Shared API types, endpoints, data-service — used by both frontend and backend |
| `/client` | TypeScript/React | Frontend | `packages/data-provider`, `packages/client` | Frontend SPA |
| `/packages/client` | TypeScript | Frontend | `packages/data-provider` | Shared frontend utilities |

The source code for `@librechat/agents` (major backend dependency, same team) is at `/home/danny/agentus`.

---

## Workspace Boundaries

- **All new backend code must be TypeScript** in `/packages/api`.
- Keep `/api` changes to the absolute minimum (thin JS wrappers calling into `/packages/api`).
- Database-specific shared logic goes in `/packages/data-schemas`.
- Frontend/backend shared API logic (endpoints, types, data-service) goes in `/packages/data-provider`.
- Build data-provider from project root: `npm run build:data-provider`.

---

## Code Style

### Naming and File Organization

- **Single-word file names** whenever possible (e.g., `permissions.ts`, `capabilities.ts`, `service.ts`).
- When multiple words are needed, prefer grouping related modules under a **single-word directory** rather than using multi-word file names (e.g., `admin/capabilities.ts` not `adminCapabilities.ts`).
- The directory already provides context — `app/service.ts` not `app/appConfigService.ts`.

### Structure and Clarity

- **Never-nesting**: early returns, flat code, minimal indentation. Break complex operations into well-named helpers.
- **Functional first**: pure functions, immutable data, `map`/`filter`/`reduce` over imperative loops. Only reach for OOP when it clearly improves domain modeling or state encapsulation.
- **No dynamic imports** unless absolutely necessary.

### DRY

- Extract repeated logic into utility functions.
- Reusable hooks / higher-order components for UI patterns.
- Parameterized helpers instead of near-duplicate functions.
- Constants for repeated values; configuration objects over duplicated init code.
- Shared validators, centralized error handling, single source of truth for business rules.
- Shared typing system with interfaces/types extending common base definitions.
- Abstraction layers for external API interactions.

### Iteration and Performance

- **Minimize looping** — especially over shared data structures like message arrays, which are iterated frequently throughout the codebase. Every additional pass adds up at scale.
- Consolidate sequential O(n) operations into a single pass whenever possible; never loop over the same collection twice if the work can be combined.
- Choose data structures that reduce the need to iterate (e.g., `Map`/`Set` for lookups instead of `Array.find`/`Array.includes`).
- Avoid unnecessary object creation; consider space-time tradeoffs.
- Prevent memory leaks: careful with closures, dispose resources/event listeners, no circular references.

### Type Safety

- **Never use `any`**. Explicit types for all parameters, return values, and variables.
- **Limit `unknown`** — avoid `unknown`, `Record<string, unknown>`, and `as unknown as T` assertions. A `Record<string, unknown>` almost always signals a missing explicit type definition.
- **Don't duplicate types** — before defining a new type, check whether it already exists in the project (especially `packages/data-provider`). Reuse and extend existing types rather than creating redundant definitions.
- Use union types, generics, and interfaces appropriately.
- All TypeScript and ESLint warnings/errors must be addressed — do not leave unresolved diagnostics.

### Comments and Documentation

- Write self-documenting code; no inline comments narrating what code does.
- JSDoc only for complex/non-obvious logic or intellisense on public APIs.
- Single-line JSDoc for brief docs, multi-line for complex cases.
- Avoid standalone `//` comments unless absolutely necessary.

### Import Order

Imports are organized into three sections:

1. **Package imports** — sorted shortest to longest line length (`react` always first).
2. **`import type` imports** — sorted longest to shortest (package types first, then local types; length resets between sub-groups).
3. **Local/project imports** — sorted longest to shortest.

Multi-line imports count total character length across all lines. Consolidate value imports from the same module. Always use standalone `import type { ... }` — never inline `type` inside value imports.

### JS/TS Loop Preferences

- **Limit looping as much as possible.** Prefer single-pass transformations and avoid re-iterating the same data.
- `for (let i = 0; ...)` for performance-critical or index-dependent operations.
- `for...of` for simple array iteration.
- `for...in` only for object property enumeration.

---

## Frontend Rules (`client/src/**/*`)

### Localization

- All user-facing text must use `useLocalize()`.
- Only update English keys in `client/src/locales/en/translation.json` (other languages are automated externally).
- Semantic key prefixes: `com_ui_`, `com_assistants_`, etc.

### Components

- TypeScript for all React components with proper type imports.
- Semantic HTML with ARIA labels (`role`, `aria-label`) for accessibility.
- Group related components in feature directories (e.g., `SidePanel/Memories/`).
- Use index files for clean exports.

### Data Management

- Feature hooks: `client/src/data-provider/[Feature]/queries.ts` → `[Feature]/index.ts` → `client/src/data-provider/index.ts`.
- React Query (`@tanstack/react-query`) for all API interactions; proper query invalidation on mutations.
- QueryKeys and MutationKeys in `packages/data-provider/src/keys.ts`.

### Data-Provider Integration

- Endpoints: `packages/data-provider/src/api-endpoints.ts`
- Data service: `packages/data-provider/src/data-service.ts`
- Types: `packages/data-provider/src/types/queries.ts`
- Use `encodeURIComponent` for dynamic URL parameters.

### Performance

- Prioritize memory and speed efficiency at scale.
- Cursor pagination for large datasets.
- Proper dependency arrays to avoid unnecessary re-renders.
- Leverage React Query caching and background refetching.

---

## Development Commands

| Command | Purpose |
|---|---|
| `npm run smart-reinstall` | Install deps (if lockfile changed) + build via Turborepo |
| `npm run reinstall` | Clean install — wipe `node_modules` and reinstall from scratch |
| `npm run backend` | Start the backend server |
| `npm run backend:dev` | Start backend with file watching (development) |
| `npm run build` | Build all compiled code via Turborepo (parallel, cached) |
| `npm run frontend` | Build all compiled code sequentially (legacy fallback) |
| `npm run frontend:dev` | Start frontend dev server with HMR (port 3090, requires backend running) |
| `npm run build:data-provider` | Rebuild `packages/data-provider` after changes |

- Node.js: v24.16.0
- Database: MongoDB
- Backend runs on `http://localhost:3080/`; frontend dev server on `http://localhost:3090/`

---

## Deployment (single stand: qsr)

Production URL: **https://qsr.1ma.ai** — one VPS at a local hoster (`ssh qsr`), being handed
over to the client starting August 2026. Treat every deploy as touching a client system.

> **History & near future, so you don't repeat past agents' mistakes:** the Railway
> project is retired and the `lab.1ma.ai` stand is **temporarily switched off**
> (July 2026, see `HOSTER_MIGRATION_Plan.md`) — the team pays for one stand while qsr
> serves the client. After qsr is handed over (August 2026), lab.1ma.ai is planned to
> come back as the internal test stand. Until that happens there is **no test stand and
> no auto-deploy anywhere** — do not describe merges as "deploying to the lab".
> `*.railway.internal` hostnames still present in `1ma-lab/librechat.yaml` are legacy
> names, NOT live Railway services — `1ma-lab/deploy/scripts/render-config.sh` rewrites
> `<service>.railway.internal` → `<service>` (plain Docker network names) at deploy time.

### How a change reaches prod

```
merge PR to platform-librechat/main
  → .github/workflows/docker-image.yml builds & pushes
    ghcr.io/kirillmachuk/platform-librechat:sha-<short-sha>   (~4 min, push to main only)
  → bump the FROM pin in 1ma-lab/Dockerfile to the new sha- tag → merge that PR
  → ssh qsr 'cd /opt/1ma/1ma-lab/deploy && ./scripts/update.sh'
```

- **Merging to `main` does NOT deploy anything by itself.** It only publishes an image.
  The `FROM` pin in `1ma-lab/Dockerfile` is the single source of truth for what runs in prod.
- Rollback = restore the previous `sha-` pin in `1ma-lab/Dockerfile`, then `update.sh`
  (see `STABILIZATION_Handoff.md` for a worked example).
- `gen-env.sh` does not overwrite `stack.env`; `render-config.sh` regenerates
  `runtime/librechat.yaml` from the repo — manual config edits on the box get lost.

### Repos involved

| Repo | Role |
|---|---|
| `KirillMachuk/platform-librechat` | Source code (this repo) — all code changes go here |
| `KirillMachuk/1ma-lab` | Deploy config for the qsr box: image pin (`Dockerfile`), `librechat.yaml`, env generation, `update.sh` |

### Important notes for agents

- **Never push code to `1ma-lab`** — it is deploy-config only. All code lives here.
- **Batch merges; the pin bump is the deploy unit.** Land related PRs together, then move
  the pin once — each pin bump restarts the service for live users.
- **GitHub Actions minutes are only free while this repo is public.** It was switched to
  private once and burned ~1800 of the 2000/month minutes in three weeks. Keep it public;
  if it ever must go private, disable the inherited upstream workflows first.
- **CI scope:** the frontend suite (`frontend-review.yml`) runs on PRs touching `client/**`,
  `packages/client/**`, `packages/data-provider/**` and on push to `main` for the same paths;
  the backend suite (`backend-review.yml`) runs on `api/**` and `packages/**`; the hermetic
  Playwright mock e2e suite (`playwright-mock.yml`) runs on **every** PR. A path-filtered
  workflow is skipped, not failed, so a green PR does not always mean a suite ran — check
  which ones did before trusting it.

---

## Testing

- Framework: **Jest**, run per-workspace; **Playwright** for e2e (`e2e/`, mock profile).
- Run tests from their workspace directory: `cd api && npx jest <pattern>`, `cd packages/api && npx jest <pattern>`, etc.
- Frontend tests: `__tests__` directories alongside components; use `test/layout-test-utils` for rendering.
- Cover loading, success, and error states for UI/data flows.
- **`e2e/COVERAGE_MAP.md` is the inventory of user behavior and its owning tests.** A PR that
  adds or changes user-facing behavior updates it; `npm run check:coverage-map` (CI-enforced)
  fails when a claimed test no longer exists.
- A test counts only once it has been **seen red** — break the behavior on purpose, watch it
  fail, restore. This repo has caught four wrong "green" tests that way.

### Philosophy

- **Real logic over mocks.** Exercise actual code paths with real dependencies. Mocking is a last resort.
- **Spies over mocks.** Assert that real functions are called with expected arguments and frequency without replacing underlying logic.
- **MongoDB**: use `mongodb-memory-server` for a real in-memory MongoDB instance. Test actual queries and schema validation, not mocked DB calls.
- **MCP**: use real `@modelcontextprotocol/sdk` exports for servers, transports, and tool definitions. Mirror real scenarios, don't stub SDK internals.
- Only mock what you cannot control: external HTTP APIs, rate-limited services, non-deterministic system calls.
- Heavy mocking is a code smell, not a testing strategy.

---

## Formatting

Fix all formatting lint errors (trailing spaces, tabs, newlines, indentation) using auto-fix when available. All TypeScript/ESLint warnings and errors **must** be resolved.
