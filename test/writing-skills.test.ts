import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import http from 'node:http';
import { AiHostError, AiHostService, type HostLlmChunk } from '../host/application/ai-service';
import { AI_ROUTE_PATH, createAiRoute } from '../host/http/ai-route';
import { apply as applyHostPlugin } from '../index';
import { AiClient, AiClientError, formatAiClientError } from '../src/adapters/ai-client';
import { loadWritingSkills, saveWritingSkills, WRITING_SKILLS_KEY } from '../src/adapters/storage';
import { createLibraryBackup, extractBackupWritingSkills, mergeWritingSkillStates } from '../src/domain/library-backup';
import { computeTextDiff, tokenizeDiff } from '../src/domain/text-diff';
import {
  allWritingSkills,
  applySkillPatches,
  BUILTIN_HUMANIZER_ID,
  BUILTIN_HUMANIZER_SKILL,
  buildSelectionSkillPrompt,
  createCustomSkillId,
  defaultWritingSkillState,
  findWritingSkill,
  hasMissingProtectedTokens,
  MAX_CUSTOM_SKILLS,
  nextCustomSkillName,
  parseSkillMarkdown,
  removeCustomSkill,
  resolveActiveSkill,
  sanitizeCustomSkill,
  sanitizeWritingSkillState,
  serializeSkillMarkdown,
  unwrapMarkdownFenceIfProse,
  upsertCustomSkill,
  type WritingSkill,
} from '../src/domain/writing-skills';
import type { HostContext } from '../src/types/dsh';

let checks = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  checks++;
  console.log('ok -', name);
}

await check('built-in Humanizer-zh skill embeds the verbatim open-source SKILL.md ruleset', () => {
  const initial = defaultWritingSkillState();
  assert.equal(initial.activeSkillId, BUILTIN_HUMANIZER_ID);
  assert.deepEqual(initial.customSkills, []);
  const skills = allWritingSkills(initial);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].id, BUILTIN_HUMANIZER_ID);
  assert.equal(skills[0].name, '去 AI 味');
  assert.equal(skills[0].builtin, true);
  assert.ok(skills[0].instructions.startsWith('# Humanizer-zh\n'));
  assert.ok(skills[0].instructions.includes('### 1. 不是 X，而是 Y'));
  assert.ok(skills[0].instructions.includes('### 31. 套话收尾'));
  assert.ok(skills[0].instructions.includes('## 交付前核对'));
});

await check('custom skill state sanitizes, deduplicates, caps and resolves fallbacks', () => {
  assert.equal(sanitizeCustomSkill(null), null);
  assert.equal(sanitizeCustomSkill([]), null);
  assert.equal(sanitizeCustomSkill({ id: BUILTIN_HUMANIZER_ID, name: 'x', instructions: 'y' }), null);
  assert.equal(sanitizeCustomSkill({ id: 'skill:1', name: '  ', instructions: 'y' }), null);

  const valid = sanitizeCustomSkill({
    id: 'skill:col',
    name: '  技术专栏口吻  ',
    description: '  平实克制  ',
    instructions: '  删掉套话  ',
  });
  assert.deepEqual(valid, {
    id: 'skill:col',
    name: '技术专栏口吻',
    description: '平实克制',
    instructions: '删掉套话',
  });

  const many = Array.from({ length: MAX_CUSTOM_SKILLS + 5 }, (_, idx) => ({
    id: `skill:${idx}`,
    name: `Skill ${idx}`,
    description: '',
    instructions: `Rule ${idx}`,
  }));
  const state = sanitizeWritingSkillState({
    activeSkillId: 'skill:missing',
    customSkills: [valid, valid, null, ...many],
  });
  assert.equal(state.customSkills.length, MAX_CUSTOM_SKILLS);
  assert.equal(state.activeSkillId, BUILTIN_HUMANIZER_ID);
  assert.equal(resolveActiveSkill(state).id, BUILTIN_HUMANIZER_ID);

  const activeCustom = sanitizeWritingSkillState({
    activeSkillId: 'skill:col',
    customSkills: [valid],
  });
  assert.equal(activeCustom.activeSkillId, 'skill:col');
  assert.equal(findWritingSkill(activeCustom, 'skill:col')?.name, '技术专栏口吻');
  assert.equal(findWritingSkill(activeCustom, BUILTIN_HUMANIZER_ID)?.id, BUILTIN_HUMANIZER_ID);
  assert.equal(findWritingSkill(activeCustom, 'nope'), null);
  assert.deepEqual(sanitizeWritingSkillState('bad'), defaultWritingSkillState());
});

await check('custom skill CRUD helpers manage ids, unique names, upserts and removals', () => {
  const id = createCustomSkillId();
  assert.match(id, /^skill:[a-z0-9]+-[a-z0-9]+$/);

  const s1: WritingSkill = { id: 'skill:1', name: '自定义 Skill', description: '', instructions: 'A' };
  const s2: WritingSkill = { id: 'skill:2', name: '自定义 Skill 2', description: '', instructions: 'B' };
  assert.equal(nextCustomSkillName([], '自定义 Skill'), '自定义 Skill');
  assert.equal(nextCustomSkillName([s1, s2], '自定义 Skill'), '自定义 Skill 3');

  let list = upsertCustomSkill([], s1);
  list = upsertCustomSkill(list, s2);
  assert.equal(list.length, 2);
  list = upsertCustomSkill(list, { ...s1, instructions: 'Updated' });
  assert.equal(list[0].instructions, 'Updated');

  const full = Array.from({ length: MAX_CUSTOM_SKILLS }, (_, i) => ({
    id: `skill:f${i}`,
    name: `S${i}`,
    description: '',
    instructions: 'x',
  }));
  assert.equal(
    upsertCustomSkill(full, { id: 'skill:extra', name: 'Extra', description: '', instructions: 'y' }).length,
    MAX_CUSTOM_SKILLS,
  );

  assert.deepEqual(removeCustomSkill(list, 'skill:1'), [s2]);
});

await check('SKILL.md frontmatter parser and serializer round-trip cleanly', () => {
  const md = [
    '---',
    'name: column-voice',
    'title: "一线工程师口吻"',
    "description: '保留事实，删掉空话'",
    '---',
    '',
    '## 规则',
    '1. 直接说结论。',
  ].join('\n');
  const parsed = parseSkillMarkdown(md);
  assert.equal(parsed.name, '一线工程师口吻');
  assert.equal(parsed.description, '保留事实，删掉空话');
  assert.equal(parsed.instructions, '## 规则\n1. 直接说结论。');

  const serialized = serializeSkillMarkdown({
    name: '一线工程师口吻',
    description: '保留事实，删掉空话',
    instructions: parsed.instructions,
  });
  assert.ok(serialized.includes('name: custom-writing-skill'));
  assert.ok(serialized.includes('title: "一线工程师口吻"'));
  assert.equal(parseSkillMarkdown(serialized).name, '一线工程师口吻');
  assert.ok(serialized.includes('description: "保留事实，删掉空话"'));

  const asciiSerialized = serializeSkillMarkdown({
    name: 'Tech Column v2',
    description: '',
    instructions: '# Tech Column\n\nKeep code untouched.',
  });
  assert.ok(asciiSerialized.includes('name: tech-column-v2'));
  const reparsed = parseSkillMarkdown(asciiSerialized);
  assert.equal(reparsed.name, 'Tech Column v2');

  const headingOnly = parseSkillMarkdown('# 极简叙事\n\n不要感叹号。');
  assert.equal(headingOnly.name, '极简叙事');
  assert.equal(headingOnly.description, '');
});

await check('selection prompt, fence unwrapper, patch applier and protected token guard work', () => {
  const doc = '# 标题\n\n在当今时代背景下，我们对 `config.json` 进行了测试。\n\n总而言之，让我们拭目以待！\n';
  const target = '在当今时代背景下，我们对 `config.json` 进行了测试。';
  const start = doc.indexOf(target);
  const end = start + target.length;

  const selPrompt = buildSelectionSkillPrompt({
    skill: BUILTIN_HUMANIZER_SKILL,
    title: '测试文章',
    markdown: doc,
    start,
    end,
  });
  assert.ok(selPrompt.system.includes('Humanizer-zh'));
  assert.ok(selPrompt.prompt.includes('<target_text>'));
  assert.ok(selPrompt.prompt.includes('context_before_readonly'));
  assert.ok(selPrompt.prompt.includes('context_after_readonly'));

  assert.equal(unwrapMarkdownFenceIfProse('```markdown\n干净的正文段落。\n```', '原始散文段落。'), '干净的正文段落。');
  assert.equal(
    unwrapMarkdownFenceIfProse('```ts\nconst a = 1;\n```', '```ts\nlet a = 1;\n```'),
    '```ts\nconst a = 1;\n```',
  );

  const tail = '\n\n总而言之，让我们拭目以待！';
  const tailStart = doc.indexOf(tail);
  const patches = [
    {
      id: 'S1',
      start,
      end,
      original: target,
      replacement: '我们测试了 `config.json`。',
    },
    {
      id: 'S2',
      start: tailStart,
      end: tailStart + tail.length,
      original: tail,
      replacement: '',
    },
  ];

  const applied = applySkillPatches(doc, patches);
  assert.equal(applied, '# 标题\n\n我们测试了 `config.json`。\n');
  assert.equal(applySkillPatches(doc, []), doc);

  {
    const codeDoc = '原句很长。\n\n```py\ndef a():\n    pass\n\n\ndef b():\n    pass\n```\n';
    const patched = applySkillPatches(codeDoc, [
      { id: 'S1', start: 0, end: '原句很长。'.length, original: '原句很长。', replacement: '短句。' },
    ]);
    assert.equal(
      patched,
      '短句。\n\n```py\ndef a():\n    pass\n\n\ndef b():\n    pass\n```\n',
      'accepting a patch never reflows blank lines elsewhere in the document',
    );
  }

  assert.equal(
    hasMissingProtectedTokens('含 `code` 与 $x_1$ 及 assets/abc.png', '含 `code` 与 $x_1$ 及 assets/abc.png'),
    false,
  );
  assert.equal(hasMissingProtectedTokens('含 `code` 与 $x_1$', '含 code 与 $x_1$'), true);
  // Generalized protected token coverage: TeX \(...\) / \[...\], tilde fences ~~~, double backticks, footnotes, currency guard
  assert.equal(
    hasMissingProtectedTokens('质能方程 \\(E = mc^2\\) 成立', '质能方程 E = mc2 成立'),
    true,
    'missing inline TeX \\(...\\) triggers syntax warning',
  );
  assert.equal(
    hasMissingProtectedTokens('公式 \\[a^2 + b^2 = c^2\\] 成立', '公式 a^2 + b^2 = c^2 成立'),
    true,
    'missing block TeX \\[...\\] triggers syntax warning',
  );
  assert.equal(
    hasMissingProtectedTokens('~~~ts\nconst x = 1;\n~~~', 'const x = 1;'),
    true,
    'missing tilde fenced code block triggers syntax warning',
  );
  assert.equal(
    hasMissingProtectedTokens('使用 ``a `b` c`` 表示嵌套反引号', '使用 a b c 表示嵌套反引号'),
    true,
    'missing multi-backtick code span triggers syntax warning',
  );
  assert.equal(
    hasMissingProtectedTokens('参考注释[^note1]说明', '参考注释说明'),
    true,
    'missing footnote reference triggers syntax warning',
  );
  assert.equal(
    hasMissingProtectedTokens('预算区间 $100/$200 可接受', '预算区间 $100 或 $200 可接受'),
    false,
    'currency amounts like $100/$200 are not misclassified as math tokens',
  );
  assert.equal(
    hasMissingProtectedTokens('  ```ts\n  const y = 2;\n  ```', '  ```ts\n  const y = 2;\n  ```'),
    false,
    'indented fenced code block is preserved cleanly',
  );
  assert.equal(
    hasMissingProtectedTokens('含转义 \\$100 与 \\$200 美元', '含转义 \\$100 和 \\$200 美元'),
    false,
    'escaped dollar signs are not treated as inline math',
  );
  // Balanced-paren and titled Markdown link URLs are protected
  assert.equal(
    hasMissingProtectedTokens(
      '参考 [wiki](https://en.wikipedia.org/wiki/Foo_(bar)) 与 [docs](https://a.example/x "Title")。',
      '参考 [wiki](https://en.wikipedia.org/wiki/Foo_(bar)) 和 [docs](https://a.example/x "Title")。',
    ),
    false,
    'balanced-paren and titled links remain protected',
  );
  assert.equal(
    hasMissingProtectedTokens(
      '参考 [wiki](https://en.wikipedia.org/wiki/Foo_(bar))。',
      '参考 [wiki](https://en.wikipedia.org/wiki/Other)。',
    ),
    true,
    'modified balanced-paren link triggers protected token warning',
  );
});

await check('computeTextDiff pinpoints Chinese/English word & punctuation deletions and additions', () => {
  const orig =
    '这是一篇功能示例。左侧是可以直接编辑的 Markdown 源码，右侧是实时排版效果；每一节先给语法，再给对应样式，方便你一一对照。';
  const next =
    '这是一篇功能示例：左侧是可以直接编辑的 Markdown 源码，右侧是实时排版效果。每一节先给语法，再给对应样式，方便你对照。';
  const diff = computeTextDiff(orig, next);

  const deletedTexts = diff.delParts.filter((p) => p.changed).map((p) => p.text);
  const addedTexts = diff.addParts.filter((p) => p.changed).map((p) => p.text);
  assert.deepEqual(deletedTexts, ['。', '；', '一一']);
  assert.deepEqual(addedTexts, ['：', '。']);
  assert.equal(diff.delOffsets.length, 3);
  assert.equal(orig.slice(diff.delOffsets[2].fromOffset, diff.delOffsets[2].toOffset), '一一');
  assert.equal(diff.addOffsets.length, 2);
  assert.equal(next.slice(diff.addOffsets[0].fromOffset, diff.addOffsets[0].toOffset), '：');
  assert.equal(next.slice(diff.addOffsets[1].fromOffset, diff.addOffsets[1].toOffset), '。');

  const same = computeTextDiff('完全一致的句子。', '完全一致的句子。');
  assert.equal(same.delOffsets.length, 0);
  assert.equal(same.addOffsets.length, 0);
  assert.deepEqual(same.segments, [{ type: 'equal', text: '完全一致的句子。' }]);
  assert.deepEqual(same.delParts, [{ text: '完全一致的句子。', changed: false }]);
  assert.deepEqual(same.addParts, [{ text: '完全一致的句子。', changed: false }]);
  assert.equal(diff.delParts.map((p) => p.text).join(''), orig, 'delParts reconstruct original text verbatim');
  assert.equal(diff.addParts.map((p) => p.text).join(''), next, 'addParts reconstruct replacement text verbatim');
  assert.deepEqual(tokenizeDiff(''), []);
  assert.deepEqual(tokenizeDiff('hello  世界🇨🇳!'), ['hello', '  ', '世', '界', '🇨🇳', '!']);
  const flagDiff = computeTextDiff('我喜欢🇨🇳排版', '我喜欢🇨🇦排版');
  assert.deepEqual(
    flagDiff.segments,
    [
      { type: 'equal', text: '我喜欢' },
      { type: 'delete', text: '🇨🇳' },
      { type: 'insert', text: '🇨🇦' },
      { type: 'equal', text: '排版' },
    ],
    'flag emoji grapheme clusters diff atomically',
  );
  assert.deepEqual(computeTextDiff('', '新增').segments, [{ type: 'insert', text: '新增' }]);
  assert.deepEqual(computeTextDiff('删掉', '').segments, [{ type: 'delete', text: '删掉' }]);
  const clauseA = '首句保持不变。' + '甲'.repeat(320) + '，尾句不变。';
  const clauseB = '首句保持不变。' + '乙'.repeat(320) + '，尾句不变。';
  const clauseDiff = computeTextDiff(clauseA, clauseB);
  assert.equal(clauseDiff.delParts.map((p) => p.text).join(''), clauseA);
  assert.equal(clauseDiff.addParts.map((p) => p.text).join(''), clauseB);
  assert.ok(clauseDiff.segments.some((s) => s.type === 'equal' && s.text.includes('首句保持不变')));
  assert.ok(clauseDiff.segments.some((s) => s.type === 'equal' && s.text.includes('尾句不变')));
  const hugeA = '甲 '.repeat(600);
  const hugeB = '乙 '.repeat(600);
  const fallback = computeTextDiff(hugeA, hugeB);
  assert.equal(fallback.delParts.map((p) => p.text).join(''), hugeA);
  assert.equal(fallback.addParts.map((p) => p.text).join(''), hugeB);
  assert.equal(
    fallback.delParts.some((p) => p.changed),
    true,
  );
  assert.equal(
    fallback.addParts.some((p) => p.changed),
    true,
  );
});

await check('local storage and library backup preserve custom writing skills solely inside Markdown Studio', () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
  };
  assert.deepEqual(loadWritingSkills(storage), defaultWritingSkillState());

  const custom: WritingSkill = {
    id: 'skill:voice',
    name: '叙事专栏',
    description: '第一人称',
    instructions: '保持克制。',
  };
  assert.equal(saveWritingSkills({ activeSkillId: custom.id, customSkills: [custom] }, storage), true);
  assert.ok(mem.has(WRITING_SKILLS_KEY));
  assert.deepEqual(loadWritingSkills(storage), { activeSkillId: custom.id, customSkills: [custom] });

  mem.set(WRITING_SKILLS_KEY, '{corrupt');
  assert.deepEqual(loadWritingSkills(storage), defaultWritingSkillState());

  const brokenStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  assert.equal(saveWritingSkills({ activeSkillId: BUILTIN_HUMANIZER_ID, customSkills: [] }, brokenStorage), false);

  const backupObj = createLibraryBackup(
    {
      activeId: 'd1',
      docs: [{ id: 'd1', title: 'T', markdown: '# T', settings: {} as never, view: 'split', updatedAt: 1 }],
      trash: [],
    },
    { activeSkillId: custom.id, customSkills: [custom] },
  );
  const extracted = extractBackupWritingSkills(backupObj);
  assert.ok(extracted);
  assert.equal(extracted.activeSkillId, custom.id);
  assert.equal(extracted.customSkills[0].name, '叙事专栏');
  assert.equal(extractBackupWritingSkills({ version: 2 }), null);

  const merged = mergeWritingSkillStates(
    {
      activeSkillId: BUILTIN_HUMANIZER_ID,
      customSkills: [{ id: 'skill:local', name: '本地规则', description: '', instructions: 'L' }],
    },
    {
      activeSkillId: custom.id,
      customSkills: [custom, { id: 'skill:local', name: '本地规则更新', description: '', instructions: 'Updated' }],
    },
  );
  assert.equal(merged.activeSkillId, custom.id);
  assert.equal(merged.customSkills.length, 2);
  assert.equal(merged.customSkills[0].name, '本地规则更新');
});

await check('AiHostService, createAiRoute and AiClient stream NDJSON and enforce loopback/input guards', async () => {
  assert.equal(AI_ROUTE_PATH, '/api/markdown-studio/ai');

  const emptyService = new AiHostService({ getLlm: () => undefined, getDefaultModel: () => undefined });
  assert.deepEqual(await emptyService.status(), { available: false, provider: '', model: '', models: [] });
  await assert.rejects(
    () => emptyService.stream({ system: 's', prompt: 'p' }, () => {}),
    (err: unknown) => err instanceof AiHostError && err.code === 'LLM_UNAVAILABLE',
  );

  let finishMode: 'stop' | 'error' | 'aborted' | 'throw' | 'max-tokens' = 'stop';
  const streamInputs: Array<Record<string, unknown>> = [];
  let modelEfforts: Array<{ id: string; name: string }> | 'throw' = [
    { id: 'off', name: 'Off' },
    { id: 'high', name: 'High' },
  ];
  const liveService = new AiHostService({
    getLlm: () => ({
      listProviders: async () => [{ id: 'deepseek-account', name: 'DeepSeek Account' }, 'custom-openai', { id: '' }],
      listModels: async (provider) =>
        provider === 'deepseek-account' ? [{ provider, id: 'deepseek-chat', name: 'DeepSeek Chat' }] : [],
      resolveModelInfo: async () => {
        if (modelEfforts === 'throw') throw new Error('no metadata');
        return { defaultMaxTokens: 8192, reasoning: { efforts: modelEfforts, defaultEffort: 'high' } };
      },
      async *stream(input): AsyncIterable<HostLlmChunk> {
        streamInputs.push(input as unknown as Record<string, unknown>);
        if (finishMode === 'throw') throw new Error('boom');
        if (input.signal?.aborted) {
          yield { type: 'finish', reason: { kind: 'aborted' } };
          return;
        }
        yield { type: 'text-delta', index: 0, text: '精简后的' };
        yield { type: 'text-delta', index: 0, text: '自然句子。' };
        if (finishMode === 'error') {
          yield { type: 'finish', reason: { kind: 'error', failure: { code: 'RATE_LIMIT', message: '请求过快' } } };
          return;
        }
        if (finishMode === 'aborted') {
          yield { type: 'finish', reason: { kind: 'aborted' } };
          return;
        }
        if (finishMode === 'max-tokens') {
          yield { type: 'finish', reason: { kind: 'max-tokens' } };
          return;
        }
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    }),
    getDefaultModel: () => ({
      currentSelection: () => undefined,
    }),
  });

  await assert.rejects(
    () => liveService.stream({ system: 's', prompt: '   ' }, () => {}),
    (err: unknown) => err instanceof AiHostError && err.code === 'EMPTY_PROMPT',
  );
  await assert.rejects(
    () => liveService.stream({ system: 'x'.repeat(70_000), prompt: 'ok' }, () => {}),
    (err: unknown) => err instanceof AiHostError && err.code === 'INPUT_TOO_LARGE',
  );

  const unconfiguredService = new AiHostService({
    getLlm: () => ({
      async *stream(): AsyncIterable<HostLlmChunk> {
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    }),
    getDefaultModel: () => ({ currentSelection: () => undefined }),
  });
  await assert.rejects(
    () => unconfiguredService.stream({ system: '', prompt: 'hi' }, () => {}),
    (err: unknown) => err instanceof AiHostError && err.code === 'MODEL_UNCONFIGURED',
  );
  const explicit = await unconfiguredService.stream({ system: '', prompt: 'hi', provider: 'p', model: 'm' }, () => {});
  assert.deepEqual(explicit, { provider: 'p', model: 'm' });

  const route = createAiRoute({ service: liveService, maxBodyBytes: 4096 });
  const server = http.createServer((req, res) => {
    void route(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('expected TCP port');
  const endpoint = `http://127.0.0.1:${address.port}${AI_ROUTE_PATH}`;

  try {
    const client = new AiClient(endpoint);
    const status = await client.status();
    assert.equal(status.available, true);
    assert.equal(status.provider, 'deepseek-account');
    assert.equal(status.model, 'deepseek-chat');
    assert.equal(status.models.length, 1);

    const deltas: string[] = [];
    const streamed = await client.stream({
      system: 'sys',
      prompt: 'hello',
      onDelta: (d) => deltas.push(d),
    });
    assert.equal(deltas.join(''), '精简后的自然句子。');
    assert.equal(streamed.text, '精简后的自然句子。');
    assert.equal(streamed.provider, 'deepseek-account');
    assert.equal(streamInputs.at(-1)?.reasoningEffort, 'off', 'selects reasoningEffort=off when supported');
    assert.equal(
      streamInputs.at(-1)?.temperature,
      undefined,
      'omits temperature to remain compatible with thinking adapters',
    );
    assert.equal(
      streamInputs.at(-1)?.maxTokens,
      undefined,
      'omits maxTokens so LlmRuntime applies model defaultMaxTokens',
    );

    modelEfforts = [{ id: 'high', name: 'High' }];
    await client.stream({ system: 'sys', prompt: 'hello' });
    assert.equal(streamInputs.at(-1)?.reasoningEffort, undefined, 'omits reasoningEffort when off is unsupported');

    modelEfforts = 'throw';
    await client.stream({ system: 'sys', prompt: 'hello' });
    assert.equal(streamInputs.at(-1)?.reasoningEffort, undefined, 'degrades cleanly when resolveModelInfo throws');
    modelEfforts = [{ id: 'off', name: 'Off' }];

    // HTTP 404 (host not restarted yet) vs generic 502 error
    const notLoadedClient = new AiClient(
      endpoint,
      async () =>
        new Response('Not Found', {
          status: 404,
          headers: { 'content-type': 'text/plain' },
        }),
    );
    await assert.rejects(
      () => notLoadedClient.stream({ system: '', prompt: 'hi' }),
      (err: unknown) =>
        err instanceof AiClientError && err.code === 'ROUTE_NOT_LOADED' && err.message.includes('DeepSeek Harness'),
    );

    const badGatewayClient = new AiClient(
      endpoint,
      async () =>
        new Response('Bad Gateway', {
          status: 502,
          headers: { 'content-type': 'text/plain' },
        }),
    );
    await assert.rejects(
      () => badGatewayClient.stream({ system: '', prompt: 'hi' }),
      (err: unknown) => err instanceof AiClientError && err.code === 'HTTP_502' && err.message.includes('502'),
    );

    // Fallback path without ReadableStream.getReader()
    const textOnlyClient = new AiClient(endpoint, async (input, init) => {
      const real = await fetch(input, init);
      const rawText = await real.text();
      return {
        ok: real.ok,
        status: real.status,
        headers: real.headers,
        body: null,
        json: async () => JSON.parse(rawText),
        text: async () => rawText,
      } as unknown as Response;
    });
    const fallbackRes = await textOnlyClient.stream({ system: 'sys', prompt: 'hello' });
    assert.ok(fallbackRes.text.includes('精简后的自然句子'));

    // Provider error finish -> NDJSON error event -> AiClientError
    finishMode = 'error';
    await assert.rejects(
      () => client.stream({ system: 'sys', prompt: 'hello' }),
      (err: unknown) => err instanceof AiClientError && err.code === 'RATE_LIMIT',
    );

    finishMode = 'aborted';
    await assert.rejects(
      () => client.stream({ system: 'sys', prompt: 'hello' }),
      (err: unknown) => err instanceof AiClientError && err.code === 'ABORTED',
    );

    finishMode = 'throw';
    await assert.rejects(
      () => client.stream({ system: 'sys', prompt: 'hello' }),
      (err: unknown) => err instanceof AiClientError && err.code === 'INTERNAL',
    );
    finishMode = 'stop';

    // Truncated output (max-tokens) is surfaced as an error instead of a partial rewrite.
    finishMode = 'max-tokens';
    await assert.rejects(
      () => client.stream({ system: 'sys', prompt: 'hello' }),
      (err: unknown) => err instanceof AiClientError && err.code === 'OUTPUT_TRUNCATED',
    );
    finishMode = 'stop';

    // A stream that ends without its `done` event (dropped connection) is never accepted.
    const cutClient = new AiClient(endpoint, async () => {
      const body = '{"type":"delta","text":"半截"}\n';
      return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
    });
    await assert.rejects(
      () => cutClient.stream({ system: 'sys', prompt: 'hello' }),
      (err: unknown) => err instanceof AiClientError && err.code === 'STREAM_INTERRUPTED',
    );

    // HTTP & security envelope rejections
    const getRes = await fetch(endpoint, { method: 'GET' });
    assert.equal(getRes.status, 405);

    const badOrigin = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ action: 'ai.status' }),
    });
    assert.equal(badOrigin.status, 403);

    const badContentType = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    assert.equal(badContentType.status, 415);

    const unknownAction = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'unknown' }),
    });
    assert.equal(unknownAction.status, 400);

    const badJson = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{invalid',
    });
    assert.equal(((await badJson.json()) as { error: { code: string } }).error.code, 'BAD_JSON');

    const arrayJson = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[]',
    });
    assert.equal(((await arrayJson.json()) as { error: { code: string } }).error.code, 'BAD_JSON');

    const tooLarge = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'ai.stream', prompt: 'a'.repeat(5000) }),
    });
    assert.equal(((await tooLarge.json()) as { error: { code: string } }).error.code, 'BODY_TOO_LARGE');

    // Non-loopback check via mock req/res
    let mockStatus = 0;
    const mockReq = {
      method: 'POST',
      socket: { remoteAddress: '192.168.1.9' },
      headers: { 'content-type': 'application/json' },
    } as unknown as IncomingMessage;
    const mockRes = {
      headersSent: false,
      set statusCode(code: number) {
        mockStatus = code;
      },
      setHeader() {},
      end() {},
    } as unknown as ServerResponse;
    await route(mockReq, mockRes);
    assert.equal(mockStatus, 403);

    // Offline / abort client checks
    const offlineClient = new AiClient('http://127.0.0.1:1/unreachable', async () => {
      throw new Error('ECONNREFUSED');
    });
    assert.equal((await offlineClient.status()).available, false);
    await assert.rejects(
      () => offlineClient.stream({ system: '', prompt: 'hi' }),
      (err: unknown) => err instanceof AiClientError && err.code === 'HOST_UNAVAILABLE',
    );
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      () => offlineClient.stream({ system: '', prompt: 'hi', signal: ac.signal }),
      (err: unknown) => err instanceof AiClientError && err.code === 'ABORTED',
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // Verify index.ts host plugin registers and disposes AI_ROUTE_PATH cleanly
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void | Promise<void>>();
  const cleanups: Array<() => void> = [];
  const mockCtx: HostContext = {
    llm: {
      async *stream(): AsyncIterable<HostLlmChunk> {
        yield { type: 'finish', reason: { kind: 'stop' } };
      },
    },
    agentDefaultModel: {
      currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }),
    },
    webServer: {
      register(entry) {
        routes.set(entry.path, entry.handler);
        return () => {
          routes.delete(entry.path);
        };
      },
    },
    effect(fn) {
      const ret = fn();
      if (typeof ret === 'function') cleanups.push(ret);
    },
  };
  applyHostPlugin(mockCtx);
  assert.ok(routes.has(AI_ROUTE_PATH), 'host apply() registers /api/markdown-studio/ai');
  for (const fn of cleanups) fn();
  assert.equal(routes.has(AI_ROUTE_PATH), false, 'host effect cleanup unregisters /api/markdown-studio/ai');
});

await check('formatAiClientError prioritizes structured error codes over loose substring patterns', () => {
  const t = (key: string) => key;
  assert.equal(
    formatAiClientError(new AiClientError('STREAM_INTERRUPTED', 'upstream dropped chunk 401 before EOF'), t),
    'err.aiStreamInterrupted',
    'structured STREAM_INTERRUPTED wins over bare 401 in message',
  );
  assert.equal(
    formatAiClientError(new AiClientError('HTTP_401', 'HTTP 401'), t),
    'err.aiApiKeyMissing',
    'explicit HTTP_401 maps to API key missing',
  );
  assert.equal(
    formatAiClientError(new AiClientError('RATE_LIMITED', 'slow down'), t),
    'err.aiRateLimited',
    'explicit RATE_LIMITED maps to rate limit error',
  );
  assert.equal(
    formatAiClientError(new AiClientError('HTTP_429', 'HTTP 429'), t),
    'err.aiRateLimited',
    'explicit HTTP_429 maps to rate limit error',
  );
  assert.equal(
    formatAiClientError(new AiClientError('INTERNAL', 'Too many requests (status 429)'), t),
    'err.aiRateLimited',
    'generic INTERNAL with rate-limit message maps to err.aiRateLimited',
  );
  assert.equal(
    formatAiClientError(new AiClientError('INTERNAL', 'HTTP 401 Unauthorized'), t),
    'err.aiApiKeyMissing',
    'generic INTERNAL with explicit HTTP 401 maps to err.aiApiKeyMissing',
  );
  assert.equal(
    formatAiClientError(new AiClientError('INTERNAL', 'worker failed at line 401'), t),
    'err.internal',
    'generic INTERNAL with unrelated number 401 does not falsely claim missing API key',
  );
  assert.equal(
    formatAiClientError(new AiClientError('ROUTE_NOT_LOADED', 'HTTP 404'), t),
    'err.aiRouteNotLoaded',
    'ROUTE_NOT_LOADED maps cleanly via i18n key without hardcoded Chinese',
  );
});

await check('G5 regressions: patch overlap, YAML block scalars, stale provider fallback & HTTP 401 JSON', async () => {
  // Overlapping and OOB patches stay non-corrupting
  assert.equal(
    applySkillPatches('abcdefghij', [
      { id: '1', start: 2, end: 6, original: 'cdef', replacement: 'X' },
      { id: '2', start: 4, end: 8, original: 'efgh', replacement: 'Y' },
      { id: '3', start: -5, end: 999, original: 'bad', replacement: 'Z' },
    ]),
    'abcdYij',
  );
  // Hallucinated URL suffix triggers protected token warning
  assert.equal(
    hasMissingProtectedTokens(
      'See [docs](https://example.com) now.',
      'See [docs](https://example.com/hallucinated-404) now.',
    ),
    true,
  );
  // Non-frontmatter HR --- preserved, YAML > and | block scalars parsed
  const hrSkill = parseSkillMarkdown('---\nKeep rule 1.\n---\nKeep rule 2.');
  assert.ok(hrSkill.instructions.includes('Keep rule 1.'));
  const foldedSkill = parseSkillMarkdown(
    '---\n# comment\nname: "Col Editor"\ndescription: >\n  Line one.\n  Line two.\ntags:\n  - writing\n  - style\nextra: |+\n  A\n  B\n---\nBody text.',
  );
  assert.equal(foldedSkill.name, 'Col Editor');
  assert.equal(foldedSkill.description, 'Line one. Line two.');
  assert.equal(foldedSkill.instructions, 'Body text.');

  // AiHostService stale default provider falls back to available model & classifies 401/429 errors
  const staleSvc = new AiHostService({
    getLlm: () => ({
      listProviders: async () => ['openai'],
      listModels: async () => [{ provider: 'openai', id: 'gpt-4o', name: 'GPT-4o' }],
      stream() {
        return {
          [Symbol.asyncIterator]() {
            return {
              next: async () => {
                throw new Error('upstream HTTP 401 Unauthorized');
              },
            };
          },
        };
      },
    }),
    getDefaultModel: () => ({ currentSelection: () => ({ provider: 'stale-provider', model: '' }) }),
  });
  const st = await staleSvc.status();
  assert.equal(st.available, true);
  assert.equal(st.provider, 'openai');
  await assert.rejects(
    () => staleSvc.stream({ system: 'sys', prompt: 'hi' }, () => {}),
    (err: unknown) => err instanceof AiHostError && err.code === 'API_KEY_MISSING',
  );
  const rateSvc = new AiHostService({
    getLlm: () => ({
      stream() {
        return {
          [Symbol.asyncIterator]() {
            return {
              next: async () => {
                throw new Error('HTTP 429 Too Many Requests');
              },
            };
          },
        };
      },
    }),
    getDefaultModel: () => ({ currentSelection: () => ({ provider: 'p', model: 'm' }) }),
  });
  await assert.rejects(
    () => rateSvc.stream({ system: 'sys', prompt: 'hi' }, () => {}),
    (err: unknown) => err instanceof AiHostError && err.code === 'RATE_LIMITED',
  );

  // AiClient HTTP 401 JSON without plugin error.code maps to HTTP_401 instead of generic AI_ERROR
  const client401 = new AiClient(
    '/api/markdown-studio/ai',
    async () =>
      new Response(JSON.stringify({ detail: 'missing api key' }), {
        status: 401,
        headers: { 'Content-Type': 'APPLICATION/JSON; charset=utf-8' },
      }),
  );
  await assert.rejects(
    () => client401.stream({ system: 's', prompt: 'p' }),
    (err: unknown) => err instanceof AiClientError && err.code === 'HTTP_401',
  );
  const clientBadJson = new AiClient(
    '/api/markdown-studio/ai',
    async () => new Response('{not-json', { status: 502, headers: { 'content-type': 'application/json' } }),
  );
  await assert.rejects(
    () => clientBadJson.stream({ system: 's', prompt: 'p' }),
    (err: unknown) => err instanceof AiClientError && err.code === 'HTTP_502',
  );

  // G2 & G5 regressions: bare 401 line number is NOT API_KEY_MISSING; upstream secret scrubbed; 600-char CJK pinpoint diff
  const bare401Svc = new AiHostService({
    getLlm: () => ({
      stream() {
        return {
          [Symbol.asyncIterator]() {
            return {
              next: async () => {
                throw new Error('Failed parsing JSON at line 401 column 5');
              },
            };
          },
        };
      },
    }),
    getDefaultModel: () => ({ currentSelection: () => ({ provider: 'p', model: 'm' }) }),
  });
  await assert.rejects(
    () => bare401Svc.stream({ system: 'sys', prompt: 'hi' }, () => {}),
    (err: unknown) => !(err instanceof AiHostError && err.code === 'API_KEY_MISSING'),
    'bare 401 line number is not misclassified as API_KEY_MISSING',
  );
  const leakSvc = new AiHostService({
    getLlm: () => ({
      stream() {
        return {
          [Symbol.asyncIterator]() {
            let done = false;
            return {
              next: async () => {
                if (done) return { value: undefined, done: true };
                done = true;
                return {
                  value: {
                    type: 'finish',
                    reason: {
                      kind: 'error',
                      failure: { code: 'CUSTOM_SECRET', message: 'Bearer sk-live-secret-token-9999 rejected' },
                    },
                  },
                  done: false,
                };
              },
            };
          },
        };
      },
    }),
    getDefaultModel: () => ({ currentSelection: () => ({ provider: 'p', model: 'm' }) }),
  });
  await assert.rejects(
    () => leakSvc.stream({ system: 'sys', prompt: 'hi' }, () => {}),
    (err: unknown) => err instanceof AiHostError && !err.message.includes('sk-live-secret') && err.code === 'LLM_ERROR',
    'upstream failure message containing bearer tokens is scrubbed',
  );
  const baseSentence = '工程团队在发布前需要检查接口兼容与安全边界，避免回归缺陷流入生产环境。';
  const longOrig = '首句需要核对。' + baseSentence.repeat(18) + '尾句需要复盘。';
  const longNext = '首句已核对。' + baseSentence.repeat(18) + '尾句已复盘。';
  assert.ok(longOrig.length > 600, 'CJK diff benchmark exceeds 600 chars');
  const longDiff = computeTextDiff(longOrig, longNext);
  const addedChars = longDiff.addParts.filter((p) => p.changed).reduce((sum, p) => sum + p.text.length, 0);
  assert.ok(
    addedChars / longNext.length < 0.1,
    `600+ char CJK diff pinpoints edits instead of full replacement (ratio ${(addedChars / longNext.length).toFixed(3)})`,
  );
});

console.log(`\n${checks} writing-skills checks passed.`);
