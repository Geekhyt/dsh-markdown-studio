---
name: perf-benchmark
description: >-
  Scientific performance measurement and iterative optimization protocol for
  dsh-markdown-studio. Activate before claiming a speedup or regression,
  modifying performance budgets in test/fuzz-and-perf.test.ts or
  scripts/bundle-budget.ts, or optimizing Markdown parsing, CSS inlining,
  block-level DOM morph, dark preview, or bundle boot latency.
license: MIT
---

<!-- Adapted from benchmark-checklist, perf-issue, hillclimb, and show-me-your-work in cursor/plugins/pstack (MIT, © Lauren Tan). See THIRD_PARTY_NOTICES.md. -->

# Performance Benchmarking & Optimization (`dsh-markdown-studio`)

Never claim a speedup from code inspection or a single noisy `performance.now()` reading. Every performance number must survive the 7-question checklist below; every sustained optimization loop runs one hypothesis per measurement.

## 1. Before Running Anything

1. **Write the exact claim** you intend to report (e.g. *"10k-char Markdown + CSS inline p50 drops from 24 ms to 15 ms"*). The 7 questions test that sentence.
2. **Read the harness** (`test/fuzz-and-perf.test.ts`, `scripts/bundle-budget.ts`, or a scratch script) and note what it times, warms up, counts, and ignores.
3. **Check host load** (`uptime` and `sysctl -n hw.ncpu`). If the machine is busy, interleave before/after runs so both sides share the same noise and note it in the report.

## 2. The Seven-Question Benchmark Checklist

Answer each question with evidence from real runs. For a quick ballpark, one run is acceptable only if you still verify questions 4 and 7 and label it as a single ballpark run. Library/architecture choices are never ballparks.

1. **Why not double? (Name the limiter.)** Profile in a separate unmeasured run (`node --cpu-prof` / DevTools performance trace) and map the hot spot to source. If a change did not move the number, the limiter explains why.
2. **Was it tuned? (Production parity.)** Compare built production chunks (`npm run build`) under identical warm/cold cache states, identical inputs, and identical flags. Never compare an uncached baseline against a pre-warmed cache unless caching is the change under test.
3. **Did it break limits? (Amdahl sanity check.)** Check the arithmetic: eliminating a step that accounts for 10% of end-to-end time yields at most ~11% total speedup. A speedup exceeding its share measured a cache hit, a skipped path, or a bug.
4. **Did it error?** Count thrown errors, fallback paths, and verify output equivalence (e.g. rendered HTML / WeChat lint / DOM parity). Fast rejections and silent fallbacks masquerade as speedups.
5. **Does it reproduce?** Run at least **5 alternating iterations per side** (`A, B, A, B, ...`) so JIT warmup, caches, and thermal drift favor neither. Report **median and min–max range**. A delta smaller than run-to-run spread is no measurable difference.
6. **Does it matter end-to-end?** Alongside any micro-benchmark (e.g. CSS tokenizer or LRU lookup), measure the user-facing path (full parse + inline + preview DOM morph or Chromium paint) and state the micro-step's share of total latency.
7. **Did the work actually happen?** Consume the return value (length/hash/DOM mutation check) inside the timed region so lazy generators, unawaited promises, or dead-code elimination cannot time a no-op.

**Verdict rule**: Lead with `faster` | `slower` | `no measurable difference` | `inconclusive`. Mark **`inconclusive`** whenever you cannot name the limiter, a side ran untuned, or questions 4 and 7 were not verified.

## 3. Seven Performance Mantras (Try Cheapest First)

Order optimization hypotheses from highest leverage to lowest; stop as soon as the target is met:

1. **Don't do it**: skip work whose output nothing consumes (e.g. defer headings/asset scans when the panel is closed).
2. **Do it, but don't do it again**: memoize / LRU-cache pure deterministic outputs (e.g. compiled CSS rules).
3. **Do it less**: narrow invalidation granularity (e.g. block-level DOM morph instead of full `innerHTML` replacement).
4. **Do it later**: lazy-load heavy chunks off cold boot (`dist/client.studio.js`, `dist/math.js`, `dist/mermaid.js`, `dist/darkmode.js`).
5. **Do it when the user isn't looking**: batch DOM reads/writes via FastDOM / `requestAnimationFrame` / idle scheduling.
6. **Do it concurrently**: parallelize independent async loads (`Promise.all`).
7. **Do it cheaper**: micro-optimize hot loops (`Set`/`Map`, linear $O(N)$ scanners, avoiding allocations).

## 4. Iterative Optimization Loop & Decision Trail

When doing multi-step optimization against a metric:

1. **Freeze the harness and regression gate** first (vet with Section 2 so every run prints error count and work count).
2. **Keep a local gitignored `decision.tsv`** (one row per attempt, single-line cells):
   ```tsv
   ts	phase	hypothesis	change	before	after	delta	tests	verdict	note
   ```
3. **One hypothesis, one measurement, keep or revert**: accept a change only when the median moves past run-to-run noise AND `npm test` + `npm run budget` stay green. Revert any speculative tweak that "might help" without measurable gain.
4. **Report shape**: verdict, primary number with unit, run count, min–max range, limiter, and regression gate result (e.g. *"10k-char render+inline median 19.4 ms → 12.1 ms (7 alternating runs, range 11.7–12.6 ms after, bound by CSS selector matching), `npm test` & `npm run budget` green"*).
