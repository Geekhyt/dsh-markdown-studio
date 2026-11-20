export interface AiModelOption {
  provider: string;
  id: string;
  name: string;
}

export interface AiStatusInfo {
  available: boolean;
  provider: string;
  model: string;
  models: AiModelOption[];
}

export interface AiStreamRequest {
  system: string;
  prompt: string;
  provider?: string;
  model?: string;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}

export interface AiStreamResult {
  text: string;
  provider: string;
  model: string;
}

export class AiClientError extends Error {
  readonly code: string;
  readonly hint: string;

  constructor(code: string, message: string, hint = '') {
    super(message);
    this.name = 'AiClientError';
    this.code = code;
    this.hint = hint;
  }
}

const AI_ERROR_CODE_KEYS: Record<string, string> = {
  ROUTE_NOT_LOADED: 'err.aiRouteNotLoaded',
  HOST_UNAVAILABLE: 'err.aiHostUnavailable',
  ABORTED: 'err.aiAborted',
  EMPTY_PROMPT: 'err.aiEmptyPrompt',
  INPUT_TOO_LARGE: 'err.aiInputTooLarge',
  STREAM_INTERRUPTED: 'err.aiStreamInterrupted',
  OUTPUT_TRUNCATED: 'err.aiOutputTruncated',
  MODEL_UNCONFIGURED: 'err.aiModelUnconfigured',
  LLM_UNAVAILABLE: 'err.aiLlmUnavailable',
  BODY_TOO_LARGE: 'err.bodyTooLarge',
  BAD_JSON: 'err.badJson',
  LOOPBACK_ONLY: 'err.loopbackOnly',
  ORIGIN_REJECTED: 'err.originRejected',
  INTERNAL: 'err.internal',
};

const API_KEY_MISSING_PATTERN = /api[\s_-]?key|unauthori[sz]ed|authentication|invalid[\s_-]?token|\b401\b/i;

export function formatAiClientError(error: unknown, t: (key: string) => string): string {
  const candidate = error && typeof error === 'object' ? (error as { code?: unknown; message?: unknown }) : null;
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  if (API_KEY_MISSING_PATTERN.test(code + ' ' + message)) return t('err.aiApiKeyMissing');
  const httpMatch = /^HTTP_(\d+)$/.exec(code);
  if (httpMatch) return `${t('err.aiHttpError')} (HTTP ${httpMatch[1]})`;
  const key = code ? AI_ERROR_CODE_KEYS[code] : '';
  if (key) return t(key);
  if (error instanceof Error && error.message) return error.message;
  return t('ai.requestFailed');
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function strOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function formatErrorMessage(message: string, hint: string): string {
  if (!hint || message.includes(hint)) return message;
  return `${message}（${hint.replace(/[。.]$/, '')}）`;
}

function httpStatusError(status: number): AiClientError {
  if (status === 404) {
    return new AiClientError(
      'ROUTE_NOT_LOADED',
      '宿主尚未加载新版 AI 服务，请完全退出并重新打开一次 DeepSeek Harness（⌘Q 重启）',
    );
  }
  return new AiClientError('HTTP_' + status, `AI 服务响应异常（HTTP ${status}）`);
}

function parseModelList(raw: unknown): AiModelOption[] {
  if (!Array.isArray(raw)) return [];
  const out: AiModelOption[] = [];
  for (const item of raw) {
    const rec = recordOf(item);
    if (!rec) continue;
    const provider = strOf(rec.provider);
    const id = strOf(rec.id);
    if (provider && id) out.push({ provider, id, name: strOf(rec.name) || id });
  }
  return out;
}

interface StreamAccumulator {
  text: string;
  provider: string;
  model: string;
  done?: boolean;
}

function consumeNdjsonLine(line: string, acc: StreamAccumulator, onDelta?: (delta: string) => void): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = recordOf(JSON.parse(trimmed));
  } catch (error) {
    return;
  }
  if (!parsed) return;
  if (parsed.type === 'delta') {
    const chunk = strOf(parsed.text);
    if (chunk) {
      acc.text += chunk;
      if (onDelta) onDelta(chunk);
    }
    return;
  }
  if (parsed.type === 'done') {
    acc.provider = strOf(parsed.provider);
    acc.model = strOf(parsed.model);
    acc.done = true;
    return;
  }
  if (parsed.type === 'error') {
    const hint = strOf(parsed.hint);
    throw new AiClientError(
      strOf(parsed.code) || 'AI_ERROR',
      formatErrorMessage(strOf(parsed.message) || '模型调用失败', hint),
      hint,
    );
  }
}

async function readStreamLines(
  response: Response,
  acc: StreamAccumulator,
  onDelta?: (delta: string) => void,
): Promise<void> {
  const reader = response.body && typeof response.body.getReader === 'function' ? response.body.getReader() : null;
  if (!reader) {
    const fullText = await response.text();
    for (const line of fullText.split('\n')) consumeNdjsonLine(line, acc, onDelta);
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    buffer += decoder.decode(step.value, { stream: true });
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      consumeNdjsonLine(buffer.slice(0, nl), acc, onDelta);
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consumeNdjsonLine(buffer, acc, onDelta);
}

export class AiClient {
  private readonly route: string;
  private readonly fetchImpl: typeof fetch;

  constructor(route = '/api/markdown-studio/ai', fetchImpl: typeof fetch = globalThis.fetch) {
    this.route = route;
    this.fetchImpl = fetchImpl;
  }

  async status(): Promise<AiStatusInfo> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'ai.status' }),
      });
    } catch (error) {
      return { available: false, provider: '', model: '', models: [] };
    }
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return { available: false, provider: '', model: '', models: [] };
    }
    const data = recordOf(await response.json());
    if (!data || data.ok !== true) {
      return { available: false, provider: '', model: '', models: [] };
    }
    return {
      available: Boolean(data.available),
      provider: strOf(data.provider),
      model: strOf(data.model),
      models: parseModelList(data.models),
    };
  }

  async stream(request: AiStreamRequest): Promise<AiStreamResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'ai.stream',
          system: request.system,
          prompt: request.prompt,
          provider: request.provider,
          model: request.model,
        }),
        signal: request.signal,
      });
    } catch (error) {
      if (request.signal?.aborted) throw new AiClientError('ABORTED', '已取消');
      throw new AiClientError('HOST_UNAVAILABLE', '无法连接宿主 AI 服务');
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = recordOf(await response.json());
      const err = recordOf(json?.error);
      const hint = strOf(err?.hint);
      throw new AiClientError(
        strOf(err?.code) || 'AI_ERROR',
        formatErrorMessage(strOf(err?.message) || 'AI 请求失败', hint),
        hint,
      );
    }
    if (!response.ok) {
      throw httpStatusError(response.status);
    }
    const acc: StreamAccumulator = { text: '', provider: '', model: '' };
    await readStreamLines(response, acc, request.onDelta);
    // A stream that ends without its `done` event was cut off: never present partial text
    // as a complete rewrite of the user's selection.
    if (!acc.done) {
      if (request.signal?.aborted) throw new AiClientError('ABORTED', '已取消');
      throw new AiClientError('STREAM_INTERRUPTED', '模型输出意外中断，请重试');
    }
    return { text: acc.text, provider: acc.provider, model: acc.model };
  }
}
