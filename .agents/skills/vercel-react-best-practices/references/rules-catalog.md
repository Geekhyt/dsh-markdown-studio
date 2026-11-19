# Vercel React Best Practices — Detailed Rules Catalog

Reference patterns for `dsh-markdown-studio`, organized by impact category from `vercel-labs/agent-skills`.

---

## 1. Eliminating Waterfalls (`async-*` · CRITICAL)

### `async-parallel` — Run independent async tasks concurrently
```ts
// BAD: sequential waterfall doubles cold-load latency
await options.mermaidAssets.ensure(doc.markdown);
await options.mathAssets.ensure();

// GOOD: concurrent execution
await Promise.all([options.mermaidAssets.ensure(doc.markdown), options.mathAssets.ensure()]);
```

### `async-cheap-condition-before-await` — Guard with cheap synchronous checks first
```ts
// BAD: loads heavy runtime before checking whether the document needs it
const mermaid = await loadMermaidChunk();
if (!extractMermaidBlocks(markdown).length) return;

// GOOD: synchronous regex/AST guard before network or chunk load
const blocks = extractMermaidBlocks(markdown);
if (!blocks.length) return;
const mermaid = await loadMermaidChunk();
```

---

## 2. Bundle Size Optimization (`bundle-*` · CRITICAL)

### `bundle-barrel-imports` — Import directly from concrete modules
- Never add `index.ts` barrel re-exports inside `src/domain/`, `src/application/`, `src/adapters/`, or `src/ui/`.
- Keep `src/shell-entry.ts` (`dist/client.js`, `< 50 KiB` gate, `~4.2 KiB` actual) free of CodeMirror 6, `mp-darkmode`, theme recipes, MathJax 3, and Mermaid 11.

### `bundle-dynamic-imports` — Load heavy capabilities on demand
- Studio workbench loads via `require.async('./client.studio.js')` only when the user opens Markdown Studio.
- MathJax (`dist/math.js`) and Mermaid (`dist/mermaid.js`) load only when formulas or `mermaid` fences appear.

---

## 3. Re-render Optimization (`rerender-*` · MEDIUM-HIGH)

### `rerender-derived-state-no-effect` — Derive values during render or reset via `key`
```ts
// BAD: syncing prop changes to local draft state via useEffect
useEffect(() => {
  setTab(props.initialTab);
}, [props.open, props.initialTab]);

// GOOD: mount a fresh inner subtree when open/requestSeq changes
if (!props.open) return null;
return React.createElement(DrawerContent, { ...props, key: props.initialTab });
```

### `rerender-lazy-state-init` — Lazy initializer functions for instances & storage reads
```ts
// BAD: mutating ref during render or re-running initializer every render
const storeRef = React.useRef<DocumentStore | null>(null);
if (!storeRef.current) storeRef.current = new DocumentStore(initial, persist);

// GOOD: React-guaranteed once-per-mount lazy initializer
const [store] = React.useState(() => new DocumentStore(initial, persist));
```

### `rerender-defer-reads` — Skip hidden-panel computations during editor typing
```ts
// BAD: scanning the entire document or library on every keystroke while the panel is closed
const headings = markdownHeadings(doc.markdown);
const referenced = new Set(collectReferencedAssets(library));

// GOOD: gate work on panel visibility
const headings = React.useMemo(
  () => (outlineOpen ? markdownHeadings(doc.markdown) : []),
  [outlineOpen, doc.markdown],
);
```

### `rerender-state-machines` — Discriminated unions over boolean state soup
```ts
// BAD: uncoordinated flags permit impossible states (loading && ready)
const [loading, setLoading] = useState(false);
const [error, setError] = useState('');
const [patches, setPatches] = useState<Patch[]>([]);

// GOOD: discriminated union makes invalid states unrepresentable
type Session =
  | { status: 'streaming'; rawOutput: string }
  | { status: 'ready'; patches: readonly Patch[] }
  | { status: 'error'; message: string };
```

---

## 4. Render Purity & Advanced Refs (`advanced-*` · HIGH)

### `advanced-use-latest` — Keep live values for callbacks without render-phase ref writes
```ts
// BAD: mutating ref.current directly during component render breaks concurrent purity
const propsRef = React.useRef(props);
propsRef.current = props;

// GOOD: sync inside src/runtime/react-lifecycle.ts useLatest
const propsRef = useLatest(React, props);
```

### Module-Scope Components & Bounded Props
- Never declare `function ChildComponent()` inside another component's render body (causes full unmount/focus loss on every parent render).
- Pass `ui: UiKit` uniformly to UI components instead of unpacking `Button`, `Input`, `Modal`, `Menu`, `Tooltip`, `Icon` individually, and group cohesive callbacks into `actions` / domain models (`<= 15` top-level fields per `*Props` interface).

---

## 5. Rendering & JavaScript Hot Paths (`rendering-*` / `js-*`)

- **`rendering-conditional-render`**: Prefer `items.length > 0 ? renderList() : null` over `items.length && renderList()` so `0` never leaks into the DOM.
- **Stable list keys**: Always key dynamic lists (`docs`, `trash`, `skills`, `customThemes`, `assets`, `conflicts`) by stable domain ID (`entry.id` / `asset.filename`), never array index.
- **`js-set-lookup`**: Convert reference lists into `Set<string>` before filtering or rendering cards (`referencedFiles.has(filename)` in `O(1)`).
