import crypto from 'node:crypto';

export interface HostLlmModelEntry {
  provider: string;
  id: string;
  name: string;
}

export type HostLlmChunk =
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'finish'; reason: { kind: string; failure?: { code?: string; message?: string } } }
  | { type: string };

export interface HostLlmMessage {
  id: string;
  role: 'user';
  content: Array<{ type: 'text'; text: string }>;
  source: { kind: 'plugin'; plugin: string };
}

export interface HostLlmGenerateInput {
  provider: string;
  model: string;
  reasoningEffort?: string;
  system?: string;
  messages: HostLlmMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export type HostLlmProviderEntry = string | { id: string; name?: string };

export interface HostLlmModelInfo {
  defaultMaxTokens?: number;
  reasoning?: {
    efforts?: ReadonlyArray<{ id: string; name?: string }>;
    defaultEffort?: string;
  };
}

export interface HostLlmRuntime {
  listProviders?: () => readonly HostLlmProviderEntry[] | Promise<readonly HostLlmProviderEntry[]>;
  listModels?: (provider: string) => readonly HostLlmModelEntry[] | Promise<readonly HostLlmModelEntry[]>;
  resolveModelInfo?: (provider: string, model: string, signal?: AbortSignal) => Promise<HostLlmModelInfo>;
  stream: (options: HostLlmGenerateInput) => AsyncIterable<HostLlmChunk>;
}

export interface HostDefaultModelSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

export interface HostDefaultModelSource {
  currentSelection: () => HostDefaultModelSelection | undefined;
}

export interface AiHostStatus {
  available: boolean;
  provider: string;
  model: string;
  models: HostLlmModelEntry[];
}

export class AiHostError extends Error {
  readonly code: string;
  readonly hint: string;

  constructor(code: string, message: string, hint = '') {
    super(message);
    this.name = 'AiHostError';
    this.code = code;
    this.hint = hint;
  }
}

const MAX_SYSTEM_CHARS = 65_536;
const MAX_PROMPT_CHARS = 200_000;

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function providerIdOf(entry: HostLlmProviderEntry): string {
  return typeof entry === 'string' ? trimString(entry) : trimString(entry?.id);
}

function appendProviderModels(out: HostLlmModelEntry[], provider: string, entries: unknown): void {
  if (!Array.isArray(entries)) return;
  for (const item of entries) {
    const id = trimString(item?.id);
    if (id) out.push({ provider, id, name: trimString(item.name) || id });
  }
}

const MODEL_LOOKUP_TIMEOUT_MS = 8_000;

async function raceWithAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
  timeoutMs = MODEL_LOOKUP_TIMEOUT_MS,
): Promise<T> {
  if (signal?.aborted) throw new AiHostError('ABORTED', '已停止生成');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        onAbort = () => reject(new AiHostError('ABORTED', '已停止生成'));
        signal?.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => reject(new AiHostError('STREAM_INTERRUPTED', '模型列表查询超时')), timeoutMs);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

async function listActiveProviderIds(llm: HostLlmRuntime, signal?: AbortSignal): Promise<string[] | null> {
  if (typeof llm.listProviders !== 'function') return null;
  const rawProviders = await raceWithAbort(Promise.resolve(llm.listProviders()), signal);
  if (!Array.isArray(rawProviders)) return null;
  return rawProviders.map(providerIdOf).filter(Boolean);
}

async function collectCatalogModels(llm: HostLlmRuntime, signal?: AbortSignal): Promise<HostLlmModelEntry[]> {
  if (typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') return [];
  const providers = await listActiveProviderIds(llm, signal);
  if (!providers || !providers.length) return [];
  const settled = await raceWithAbort(
    Promise.allSettled(providers.map(async (provider) => ({ provider, entries: await llm.listModels!(provider) }))),
    signal,
  );
  const out: HostLlmModelEntry[] = [];
  for (const item of settled) {
    if (item.status === 'fulfilled') appendProviderModels(out, item.value.provider, item.value.entries);
  }
  return out;
}

function supportsOffEffort(info: HostLlmModelInfo | undefined): boolean {
  const efforts = info?.reasoning?.efforts;
  return Array.isArray(efforts) && efforts.some((item) => item.id === 'off');
}

async function resolveFastReasoningEffort(
  llm: HostLlmRuntime,
  provider: string,
  model: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (typeof llm.resolveModelInfo !== 'function') return undefined;
  try {
    const info = await llm.resolveModelInfo(provider, model, signal);
    return supportsOffEffort(info) ? 'off' : undefined;
  } catch {
    return undefined;
  }
}

function validateStreamTexts(systemRaw: unknown, promptRaw: unknown): { system: string; prompt: string } {
  const system = typeof systemRaw === 'string' ? systemRaw : '';
  const prompt = typeof promptRaw === 'string' ? promptRaw.trim() : '';
  if (!prompt) throw new AiHostError('EMPTY_PROMPT', '待处理的文本不能为空');
  if (system.length > MAX_SYSTEM_CHARS || prompt.length > MAX_PROMPT_CHARS) {
    throw new AiHostError('INPUT_TOO_LARGE', '待处理的文本超出长度限制', '请分段选中后再执行。');
  }
  return { system, prompt };
}

const AUTH_STREAM_ERR_RE =
  /(?:(?:http|status)[\s:]*40[13]\b|\b(?:api[_ -]?key|unauthori[sz]ed|invalid[_ -]?(?:key|token)|authentication)\b)/i;
const RATE_STREAM_ERR_RE =
  /(?:(?:http|status)[\s:]*429\b|\b(?:rate[_ -]?limit|too many requests|quota|insufficient[_ -]?balance)\b)/i;

const SAFE_AUTH_CODES = new Set([
  'AUTH',
  'MISSING_CREDENTIAL',
  'INVALID_CREDENTIAL',
  'API_KEY_MISSING',
  'INVALID_API_KEY',
  'UNAUTHORIZED',
  'AUTHENTICATION_ERROR',
  'HTTP_401',
]);
const DSH_AUTH_ALIASES = new Set(['AUTH', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL']);
const SAFE_RATE_CODES = new Set(['QUOTA', 'RATE_LIMIT', 'RATE_LIMITED', 'QUOTA_EXCEEDED', 'HTTP_429']);
const SAFE_OTHER_CODES = new Set(['OUTPUT_TRUNCATED', 'ABORTED', 'LLM_ERROR', 'MODEL_UNCONFIGURED']);

function classifyLlmFailure(rawCode: string, rawMsg: string): AiHostError | null {
  if (SAFE_AUTH_CODES.has(rawCode) || AUTH_STREAM_ERR_RE.test(rawMsg)) {
    const mapped = SAFE_AUTH_CODES.has(rawCode) && !DSH_AUTH_ALIASES.has(rawCode) ? rawCode : 'API_KEY_MISSING';
    return new AiHostError(mapped, '模型鉴权失败或未配置 API Key', '请检查 DeepSeek Harness 模型设置。');
  }
  if (SAFE_RATE_CODES.has(rawCode) || RATE_STREAM_ERR_RE.test(rawMsg)) {
    const mapped = rawCode === 'QUOTA' || !SAFE_RATE_CODES.has(rawCode) ? 'RATE_LIMITED' : rawCode;
    return new AiHostError(mapped, '模型请求受限或额度不足，请稍后重试');
  }
  if (rawCode === 'CONTEXT_WINDOW_EXCEEDED') {
    return new AiHostError('INPUT_TOO_LARGE', '待处理的文本超出模型上下文上限', '请缩短选中范围后重试。');
  }
  if (rawCode === 'NO_ADAPTER' || rawCode === 'UNKNOWN_MODEL') {
    return new AiHostError(
      'MODEL_UNCONFIGURED',
      '当前模型未配置或已被禁用',
      '请在 DeepSeek Harness 设置中重新选择模型。',
    );
  }
  if (rawCode === 'TIMEOUT' || rawCode === 'EMPTY_RESPONSE' || rawCode === 'TRANSPORT') {
    return new AiHostError('STREAM_INTERRUPTED', '模型响应超时或连接中断，请重试');
  }
  return null;
}

function checkTerminalChunk(reason: { kind: string; failure?: { code?: string; message?: string } }): void {
  if (reason.kind === 'stop') return;
  if (reason.kind === 'max-tokens') {
    // A truncated rewrite would silently drop the tail of the user's selection.
    throw new AiHostError('OUTPUT_TRUNCATED', '模型输出达到长度上限，结果不完整', '请缩短选中范围后重试。');
  }
  if (reason.kind === 'aborted') {
    throw new AiHostError('ABORTED', '已停止生成');
  }
  const rawCode = trimString(reason.failure?.code);
  const rawMsg = trimString(reason.failure?.message);
  const classified = classifyLlmFailure(rawCode, rawMsg);
  if (classified) throw classified;
  const safeCode = SAFE_OTHER_CODES.has(rawCode) ? rawCode : 'LLM_ERROR';
  throw new AiHostError(safeCode, '宿主模型返回错误');
}

function rethrowStreamFailure(error: unknown, signal?: AbortSignal): never {
  if (error instanceof AiHostError) throw error;
  if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
    throw new AiHostError('ABORTED', '已停止生成');
  }
  const rawCode = error && typeof error === 'object' ? trimString((error as { code?: unknown }).code) : '';
  const rawMsg = error instanceof Error ? error.message : String(error || '');
  const classified = classifyLlmFailure(rawCode, rawMsg);
  if (classified) throw classified;
  throw error;
}

export class AiHostService {
  private readonly getLlm: () => HostLlmRuntime | undefined;
  private readonly getDefaultModel: () => HostDefaultModelSource | undefined;

  constructor(options: {
    getLlm: () => HostLlmRuntime | undefined;
    getDefaultModel: () => HostDefaultModelSource | undefined;
  }) {
    this.getLlm = options.getLlm;
    this.getDefaultModel = options.getDefaultModel;
  }

  async status(signal?: AbortSignal): Promise<AiHostStatus> {
    const llm = this.getLlm();
    if (!llm) return { available: false, provider: '', model: '', models: [] };
    let activeProviders: string[] | null = null;
    let models: HostLlmModelEntry[] = [];
    try {
      activeProviders = await listActiveProviderIds(llm, signal);
      models = await collectCatalogModels(llm, signal);
    } catch (error) {
      if (signal?.aborted || (error instanceof AiHostError && error.code === 'ABORTED')) throw error;
      models = [];
    }
    let def: HostDefaultModelSelection | undefined;
    try {
      def = this.getDefaultModel()?.currentSelection();
    } catch {
      def = undefined;
    }
    const defProvider = trimString(def?.provider);
    const defModel = trimString(def?.model);
    const defProviderActive =
      Boolean(defProvider) && (activeProviders === null || activeProviders.includes(defProvider));
    const matched =
      defProviderActive && defModel
        ? { provider: defProvider, model: defModel }
        : defProviderActive
          ? (() => {
              const first = models.find((item) => item.provider === defProvider) || models[0];
              return first ? { provider: first.provider, model: first.id } : { provider: '', model: '' };
            })()
          : models[0]
            ? { provider: models[0].provider, model: models[0].id }
            : { provider: '', model: '' };
    const provider = matched.provider;
    const model = matched.model;
    return {
      available: Boolean(provider && model),
      provider,
      model,
      models,
    };
  }

  private async resolveRoute(
    reqProvider: unknown,
    reqModel: unknown,
    signal?: AbortSignal,
  ): Promise<{ provider: string; model: string }> {
    const explicitProvider = trimString(reqProvider);
    const explicitModel = trimString(reqModel);
    if (explicitProvider && explicitModel) {
      return { provider: explicitProvider, model: explicitModel };
    }
    const llm = this.getLlm();
    let activeProviders: string[] | null = null;
    if (llm) {
      try {
        activeProviders = await listActiveProviderIds(llm, signal);
      } catch (error) {
        if (signal?.aborted || (error instanceof AiHostError && error.code === 'ABORTED')) throw error;
      }
    }
    if (!explicitProvider) {
      try {
        const def = this.getDefaultModel()?.currentSelection();
        const defProvider = trimString(def?.provider);
        const defModel = trimString(def?.model);
        if (defProvider && defModel && (activeProviders === null || activeProviders.includes(defProvider))) {
          return { provider: defProvider, model: defModel };
        }
      } catch {
        /* fallback to full catalog discovery */
      }
    }
    const current = await this.status(signal);
    if (explicitProvider) {
      const match = current.models.find((item) => item.provider === explicitProvider);
      if (match) return { provider: match.provider, model: match.id };
    }
    if (!current.provider || !current.model) {
      throw new AiHostError('MODEL_UNCONFIGURED', '未检测到可用模型', '请先在 DeepSeek Harness 设置中配置默认模型。');
    }
    return { provider: current.provider, model: current.model };
  }

  async stream(
    input: Record<string, unknown>,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<{ provider: string; model: string }> {
    const llm = this.getLlm();
    if (!llm) {
      throw new AiHostError('LLM_UNAVAILABLE', '宿主模型服务不可用', '请确认在 DeepSeek Harness 宿主环境中运行。');
    }
    if (signal?.aborted) throw new AiHostError('ABORTED', '已停止生成');
    const { system, prompt } = validateStreamTexts(input.system, input.prompt);
    const route = await this.resolveRoute(input.provider, input.model, signal);
    const reasoningEffort = await resolveFastReasoningEffort(llm, route.provider, route.model, signal);
    if (signal?.aborted) throw new AiHostError('ABORTED', '已停止生成');
    const message: HostLlmMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'plugin', plugin: 'dsh-markdown-studio' },
    };
    const streamOptions: HostLlmGenerateInput = {
      provider: route.provider,
      model: route.model,
      messages: [message],
      signal,
    };
    if (system) streamOptions.system = system;
    if (reasoningEffort) streamOptions.reasoningEffort = reasoningEffort;
    let finished = false;
    try {
      for await (const chunk of llm.stream(streamOptions)) {
        if (signal?.aborted) throw new AiHostError('ABORTED', '已停止生成');
        if (chunk.type === 'text-delta' && 'text' in chunk && chunk.text) {
          onDelta(chunk.text);
        } else if (chunk.type === 'finish' && 'reason' in chunk && chunk.reason) {
          checkTerminalChunk(chunk.reason);
          finished = true;
        }
      }
    } catch (error) {
      rethrowStreamFailure(error, signal);
    }
    if (signal?.aborted) throw new AiHostError('ABORTED', '已停止生成');
    if (!finished) {
      throw new AiHostError('STREAM_INTERRUPTED', '模型流意外中断，输出可能不完整', '请重试生成。');
    }
    return route;
  }
}
