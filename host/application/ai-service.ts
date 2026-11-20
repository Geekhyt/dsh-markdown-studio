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

function appendProviderModels(out: HostLlmModelEntry[], provider: string, entries: readonly HostLlmModelEntry[]): void {
  for (const item of entries) {
    const id = trimString(item?.id);
    if (id) out.push({ provider, id, name: trimString(item.name) || id });
  }
}

async function collectCatalogModels(llm: HostLlmRuntime): Promise<HostLlmModelEntry[]> {
  if (typeof llm.listProviders !== 'function' || typeof llm.listModels !== 'function') return [];
  const out: HostLlmModelEntry[] = [];
  for (const rawProvider of await llm.listProviders()) {
    const provider = providerIdOf(rawProvider);
    if (provider) appendProviderModels(out, provider, await llm.listModels(provider));
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
  } catch (error) {
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

function checkTerminalChunk(reason: { kind: string; failure?: { code?: string; message?: string } }): void {
  if (reason.kind === 'stop') return;
  if (reason.kind === 'max-tokens') {
    // A truncated rewrite would silently drop the tail of the user's selection.
    throw new AiHostError('OUTPUT_TRUNCATED', '模型输出达到长度上限，结果不完整', '请缩短选中范围后重试。');
  }
  if (reason.kind === 'aborted') {
    throw new AiHostError('ABORTED', '已停止生成');
  }
  const code = trimString(reason.failure?.code) || 'LLM_ERROR';
  const msg = trimString(reason.failure?.message) || '宿主模型返回错误';
  throw new AiHostError(code, msg);
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

  async status(): Promise<AiHostStatus> {
    const llm = this.getLlm();
    if (!llm) return { available: false, provider: '', model: '', models: [] };
    let models: HostLlmModelEntry[] = [];
    try {
      models = await collectCatalogModels(llm);
    } catch (error) {
      models = [];
    }
    const def = this.getDefaultModel()?.currentSelection();
    const defProvider = trimString(def?.provider);
    const defModel = trimString(def?.model);
    const matched =
      defProvider && defModel
        ? { provider: defProvider, model: defModel }
        : defProvider
          ? (() => {
              const first = models.find((item) => item.provider === defProvider);
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

  private async resolveRoute(reqProvider: unknown, reqModel: unknown): Promise<{ provider: string; model: string }> {
    const explicitProvider = trimString(reqProvider);
    const explicitModel = trimString(reqModel);
    if (explicitProvider && explicitModel) {
      return { provider: explicitProvider, model: explicitModel };
    }
    const current = await this.status();
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
    const { system, prompt } = validateStreamTexts(input.system, input.prompt);
    const route = await this.resolveRoute(input.provider, input.model);
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
    for await (const chunk of llm.stream(streamOptions)) {
      if (chunk.type === 'text-delta' && 'text' in chunk && chunk.text) {
        onDelta(chunk.text);
      } else if (chunk.type === 'finish' && 'reason' in chunk && chunk.reason) {
        checkTerminalChunk(chunk.reason);
      }
    }
    return route;
  }
}
