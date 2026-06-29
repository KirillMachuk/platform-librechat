import path from 'node:path';
import { defineConfig } from 'tsdown';

export default defineConfig({
  // The telemetry entry is a thin shim (`src/telemetry.ts`) rather than the
  // `src/telemetry/index.ts` barrel: oxc emits declarations flat into outDir keyed
  // by source basename, so two `index.ts` entries would collide (index.d.cts +
  // index2.d.cts). Distinct basenames yield stable `index.*` / `telemetry.*` output.
  entry: ['src/index.ts', 'src/telemetry.ts'],
  format: ['cjs'],
  platform: 'node',
  // tsc-based dts (not oxc) — the Deep Research rebuild uses LangGraph.js
  // `Annotation.Root`/`StateGraph` whose deeply-inferred types cannot satisfy
  // oxc's isolatedDeclarations (which requires explicit types on every export).
  // tsc infers them correctly; structured emit also avoids the basename collision
  // the oxc flat-emit workaround (telemetry shim) was guarding against.
  dts: { oxc: false },
  outDir: 'dist',
  sourcemap: true,
  // Externalize every third-party dependency (consumers provide the peers) and bundle
  // only first-party code: relative imports and the `~/*` tsconfig alias (-> src).
  // `neverBundle` is the 0.22 replacement for the deprecated `external` option.
  deps: {
    neverBundle: (id) => !id.startsWith('.') && !id.startsWith('~') && !path.isAbsolute(id),
  },
});
