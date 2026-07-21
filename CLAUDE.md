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
# create PR → review → merge to main → auto-deploy
```

Upstream remote: `upstream` → `https://github.com/danny-avila/LibreChat.git`

### Fork-specific features (not in upstream)

- **Projects** — ChatGPT-style workspaces with sources (RAG) and instructions
- **Two-tab Model Selector** — Agents | LLM picker with `defaultModel`/`defaultAgentId` config
- **Search Chats popup** — centered search dialog replacing inline SearchBar
- **Inter Variable font** — with Cyrillic + OpenType features
- **Railway deploy** — Docker entrypoint with volume permission fix

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

## Deployment Pipeline (1ma Lab)

Production URL: **https://lab.1ma.ai**

### How it works

```
push to platform-librechat/main
  → GitHub Actions (.github/workflows/docker-image.yml)
      → builds Docker image
      → pushes to ghcr.io/kirillmachuk/platform-librechat:main
      → calls Railway GraphQL API → triggers redeploy of service "1ma-lab"
          → Railway pulls fresh ghcr.io image → deploys
```

### Repos involved

| Repo | Role |
|---|---|
| `KirillMachuk/platform-librechat` | Source code (this repo) — all code changes go here |
| `KirillMachuk/1ma-lab` | Deployment config — its `Dockerfile` does `FROM ghcr.io/kirillmachuk/platform-librechat:main`. Railway's connected source, but deploys are now triggered via direct API call (not git push), so commits here are no longer needed. |

### Required GitHub secrets (in platform-librechat)

| Secret | Value |
|---|---|
| `RAILWAY_TOKEN` | Railway workspace API token (Account → Tokens → Create Token, attach to workspace) |
| `RAILWAY_PROJECT_ID` | UUID from the Railway project URL: `railway.com/project/<UUID>` |

### Important notes for agents

- **Never push directly to `1ma-lab`** for code changes — it is deploy-only. All code lives here in `platform-librechat`.
- A push to `main` here automatically deploys to production (~7–10 min build + deploy).
- **Batch deploys — do not deploy per PR.** Every merge to `main` triggers a full image build and a production deploy. Merging five PRs one by one means five builds and five production restarts. Merge the batch, then let a single build ship it. This matters for CI minutes on private repos, for build queue time, and because each deploy restarts the service for live users.
- **GitHub Actions minutes are only free while this repo is public.** It was switched to private once and burned ~1800 minutes of the 2000/month plan in three weeks — the inherited upstream workflows (Playwright E2E, Frontend Unit Tests, ESLint, Docker Smoke) run on every push. Keep it public; if it ever must go private, disable those inherited workflows first.
- The Railway API call resolves the service named `1ma-lab` and the environment named `production`. If either is renamed, update the lookup in `.github/workflows/docker-image.yml`.
- If a deploy is needed without a code change: re-run the workflow (`gh workflow run "Build & Push Docker Image"`) or manually click Redeploy in Railway.
- **CI scope gotcha:** the frontend test suite (`.github/workflows/frontend-review.yml`, jobs "Tests: Ubuntu/Windows") runs **only on pull requests** that touch `client/**`, `packages/client/**`, or `packages/data-provider/**` — **never on push to `main`**. So a green `main` only means the Docker image built; it does **not** mean the frontend tests pass. Broken client tests can land on `main` silently (and api-only PRs never run them). To gauge frontend-test health, look at a client PR's checks, not `main`'s.

---

## Testing

- Framework: **Jest**, run per-workspace.
- Run tests from their workspace directory: `cd api && npx jest <pattern>`, `cd packages/api && npx jest <pattern>`, etc.
- Frontend tests: `__tests__` directories alongside components; use `test/layout-test-utils` for rendering.
- Cover loading, success, and error states for UI/data flows.

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
