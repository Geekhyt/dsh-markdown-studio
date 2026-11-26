---
name: blast-radius
description: >-
  Pre-merge and adversarial impact review for dsh-markdown-studio. Finds
  breakage grep cannot show (DSH Cordis host seams, cross-realm DOM, storage
  migrations, CodeMirror keymaps, WeChat HTML, lazy chunks) and requires
  executable proof for both safety claims and adversarial findings. Activate
  before high-risk refactors, releases, host/security changes, or when asked
  "what could this break" or "interrogate this diff".
license: MIT
---

<!-- Adapted from blast-radius and interrogate in cursor/plugins/pstack (MIT, © Lauren Tan). See THIRD_PARTY_NOTICES.md. -->

# Blast Radius & Evidence-Only Adversarial Review (`dsh-markdown-studio`)

Listing callers with `rg` is not the job. The job is finding breakage `rg` will not show you and proving the one or two facts the change's safety depends on by running real code.

## 1. Where Grep Stops in This Repository

Check every seam a symbol search misses:

- **DSH Host & Cordis Routing (`index.ts`, `host/http/*.ts`)**: Prefix-route matching (`pathname === prefix || pathname.startsWith(prefix + '/')`, no trailing slash), `connection.requestRejection` auth enforcement across all 6 routes, loopback/origin checks, `O_NOFOLLOW`/`lstat` symlink boundaries, and hot disable/re-enable (`ctx.effect` teardown + `data-plugin="dsh-markdown-studio"` tags).
- **Cross-Realm DOM & DSH Primitives (`src/ui/dsh-primitives.ts`, `src/runtime/`)**: Host-provided portals/iframes (`instanceof Element` breaks across realms), `portal: true` tooltips in immersive flex layouts, container `.clientWidth` vs `window.innerWidth`, capture-phase LIFO `Escape` vs CodeMirror `defaultKeymap`.
- **Persisted State & Multi-Tab Sync (`src/adapters/storage.ts`, `src/domain/schema.ts`, `src/application/document-store.ts`, `src/application/use-file-context.ts`)**: `localStorage` / `IndexedDB` serialized JSON shape evolution, cross-tab `storage` events detaching linked local file handles, optimistic concurrency (`expectedStoredAt`) in `host/application/image-store.ts`.
- **WeChat HTML & Dark Preview (`src/css-inliner.ts`, `src/adapters/wechat-clipboard-dom.ts`, `src/darkmode-entry.ts`)**: Inline CSS cascade specificity, WeChat editor HTML stripping/normalization, `mp-darkmode` chunk isolation (`dist/darkmode.js` never leaking into `dist/client.studio.js`).
- **Lazy Six-Chunk Packaging (`scripts/build.ts`, `package.json`, `locale/*.json`)**: Cold-boot `dist/client.js` staying free of CodeMirror/MathJax/Mermaid/mp-darkmode, `package.json` `files` list, `THIRD_PARTY_LICENSES.txt` drift.

## 2. Five-Level Certainty Ladder (For Safety Claims)

A plausible writeup reads convincing whether or not it is true. Find the **1–2 load-bearing facts** the change is safe because of (e.g. *"this cleanup runs only after `expectedStoredAt` matches and cannot delete a re-uploaded asset"*), push each as far down this ladder as is cheap, and state where it stopped:

1. **Claimed**: Stated without citation. Worthless on its own.
2. **Cited**: Pointed at an exact `file:line` or pinned dependency source in `node_modules/`.
3. **Traced**: Walked the failure path step by step and showed it cannot reach the bad state.
4. **Executed**: Ran a focused `tsx` probe or unit/formal test against real repo code that fails loud if the fact is false.
5. **App-Reproduced**: Verified on the live running artifact (`npm run test:browser` or `npm run test:dsh`).

If you did not run step 4 or 5 for a critical safety fact, mark it **`unproven`**.

## 3. Adversarial Finding Bar (Evidence-Only Interrogation)

When stress-testing a diff or design (single-pass or multi-perspective):

- **Keep a finding only when a real run proves it breaks the stated intent**: provide the exact command, verbatim output, and the output the intent requires.
- **Drop everything unrun**: style preferences, naming debates, speculative future-only risks, and theoretical bugs that fail to reproduce against real code.
- **Merge findings sharing one root cause** and verify every surviving finding by rerunning its repro command.
- **Report zero findings honestly** ("no verified findings") when none survive execution.

## 4. Workflow

1. **Read the full change**: diff, added/changed/deleted symbols, implicit behavioral changes, and stated intent (user prompt / commit messages).
2. **Name the 1–2 safety facts**: focus effort on what makes the whole diff safe rather than listing generic maybes.
3. **Hunt past grep**: inspect third-party library behavior in `node_modules/`, event/microtask/unmount ordering, persisted wire formats, and cross-subsystem transitions (`src/domain/*.machine.ts`).
4. **Execute probes**: run the cheapest real-code repro or existing gate (`npm run verify:models`, `npm run test:fuzz`, `npm run test:browser`, `npm run test:dsh`, or a targeted `tsx` one-liner). Keep scratch probes out of the committed tree.
5. **Triage honestly**: separate confirmed risks (with likelihood, impact, `file:line`, and command output) from cleared checks and dropped unverified ideas.

## 5. Report Shape

- **What changed**: behavior diff, including non-obvious side effects.
- **Safety fact(s)**: each load-bearing fact, certainty level reached (1–5), and verbatim proof (or `unproven`).
- **Verified risks**: title, `file:line`, exact command, observed vs expected output, severity.
- **Cleared**: seams checked and why they hold.
- **Dropped**: count of discarded unverified/out-of-scope candidates and why.
- **Before shipping**: cheapest permanent test or gate (`bug-to-rule`) to lock down any surviving risk.
