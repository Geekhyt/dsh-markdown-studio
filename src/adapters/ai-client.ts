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
  HOST_BAD_RESPONSE: 'err.hostBadResponse',
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

const AUTH_ERROR_CODES = new Set([
  'AUTH',
  'MISSING_CREDENTIAL',
  'INVALID_CREDENTIAL',
  'API_KEY_MISSING',
  'INVALID_API_KEY',
  'UNAUTHORIZED',
  'AUTHENTICATION_ERROR',
  'HTTP_401',
]);

const RATE_LIMIT_CODES = new Set(['QUOTA', 'RATE_LIMIT', 'RATE_LIMITED', 'QUOTA_EXCEEDED', 'HTTP_429']);

const GENERIC_UPSTREAM_CODES = new Set(['', 'AI_ERROR', 'LLM_ERROR', 'INTERNAL']);

const API_KEY_MISSING_PATTERN =
  /api[\s_-]?key|unauthori[sz]ed|invalid[\s_-]?token|authentication[\s_-]*(?:failed|error|required)|(?:http|status)[\s:]*401\b/i;

const RATE_LIMIT_PATTERN =
  /rate[\s_-]?limit|too[\s_-]?many[\s_-]?requests|quota[\s_-]?exceeded|(?:http|status)[\s:]*429\b/i;

function formatUpstreamFallback(code: string, message: string, t: (key: string) => string): string | null {
  if (!GENERIC_UPSTREAM_CODES.has(code)) return null;
  if (API_KEY_MISSING_PATTERN.test(message)) return t('err.aiApiKeyMissing');
  if (code && RATE_LIMIT_PATTERN.test(message)) return t('err.aiRateLimited');
  return null;
}

export function formatAiClientError(error: unknown, t: (key: string) => string): string {
  const candidate = error && typeof error === 'object' ? (error as { code?: unknown; message?: unknown }) : null;
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  const message = typeof candidate?.message === 'string' ? candidate.message : '';
  if (AUTH_ERROR_CODES.has(code)) return t('err.aiApiKeyMissing');
  if (RATE_LIMIT_CODES.has(code)) return t('err.aiRateLimited');
  const structuredKey =
    code && code !== 'INTERNAL' && Object.hasOwn(AI_ERROR_CODE_KEYS, code) ? AI_ERROR_CODE_KEYS[code] : '';
  if (structuredKey) return t(structuredKey);
  const upstreamMatch = formatUpstreamFallback(code, message, t);
  if (upstreamMatch) return upstreamMatch;
  const httpMatch = /^HTTP_(\d+)$/.exec(code);
  if (httpMatch) return `${t('err.aiHttpError')} (HTTP ${httpMatch[1]})`;
  if (code && Object.hasOwn(AI_ERROR_CODE_KEYS, code)) return t(AI_ERROR_CODE_KEYS[code]);
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
  if (status === 404) return new AiClientError('ROUTE_NOT_LOADED', 'DeepSeek Harness AI route not loaded (HTTP 404)');
  return new AiClientError('HTTP_' + status, `HTTP ${status}`);
}

function parseModelOption(item: unknown): AiModelOption | null {
  const rec = recordOf(item);
  if (!rec) return null;
  const provider = strOf(rec.provider);
  const id = strOf(rec.id);
  return provider && id ? { provider, id, name: strOf(rec.name) || id } : null;
}

function parseModelList(raw: unknown): AiModelOption[] {
  if (!Array.isArray(raw)) return [];
  const out: AiModelOption[] = [];
  for (const item of raw) {
    const option = parseModelOption(item);
    if (option) out.push(option);
  }
  return out;
}

interface StreamAccumulator {
  text: string;
  provider: string;
  model: string;
  done?: boolean;
}

class DeltaCallbackError {
  constructor(readonly cause: unknown) {}
}

function consumeNdjsonLine(line: string, acc: StreamAccumulator, onDelta?: (delta: string) => void): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = recordOf(JSON.parse(trimmed));
  } catch {
    throw new AiClientError('HOST_BAD_RESPONSE', '宿主 AI 响应格式异常');
  }
  if (!parsed) throw new AiClientError('HOST_BAD_RESPONSE', '宿主 AI 响应格式异常');
  if (parsed.type === 'delta') {
    const chunk = strOf(parsed.text);
    if (chunk) {
      acc.text += chunk;
      if (onDelta) {
        try {
          onDelta(chunk);
        } catch (err) {
          throw new DeltaCallbackError(err);
        }
      }
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
  signal?: AbortSignal,
): Promise<void> {
  const reader = response.body && typeof response.body.getReader === 'function' ? response.body.getReader() : null;
  if (!reader) {
    if (signal?.aborted) throw new AiClientError('ABORTED', '已取消');
    const fullText = await response.text();
    for (const line of fullText.split('\n')) {
      if (signal?.aborted) throw new AiClientError('ABORTED', '已取消');
      consumeNdjsonLine(line, acc, onDelta);
    }
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let failed = false;
  try {
    for (;;) {
      if (signal?.aborted) throw new AiClientError('ABORTED', '已取消');
      const step = await reader.read();
      if (step.done) break;
      buffer += decoder.decode(step.value, { stream: true });
      let nl = buffer.indexOf('\n');
      while (nl >= 0) {
        if (signal?.aborted) throw new AiClientError('ABORTED', '已取消');
        consumeNdjsonLine(buffer.slice(0, nl), acc, onDelta);
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf('\n');
      }
    }
    if (signal?.aborted) throw new AiClientError('ABORTED', '已取消');
    buffer += decoder.decode();
    if (buffer.trim()) consumeNdjsonLine(buffer, acc, onDelta);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (failed) {
      try {
        await reader.cancel();
      } catch {
        /* ignore cancel errors */
      }
    }
    try {
      reader.releaseLock();
    } catch {
      /* ignore releaseLock errors */
    }
  }
}

async function throwJsonStreamError(response: Response): Promise<never> {
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    if (!response.ok) throw httpStatusError(response.status);
    throw new AiClientError('HOST_BAD_RESPONSE', '宿主 AI 响应格式异常');
  }
  const err = recordOf(recordOf(parsed)?.error);
  const errCode = strOf(err?.code);
  const errMessage = strOf(err?.message);
  if (errCode || errMessage) {
    const hint = strOf(err?.hint);
    throw new AiClientError(errCode || 'AI_ERROR', formatErrorMessage(errMessage || 'AI 请求失败', hint), hint);
  }
  if (!response.ok) throw httpStatusError(response.status);
  throw new AiClientError('AI_ERROR', 'AI 请求失败');
}

export class AiClient {
  private readonly route: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    route = '/api/markdown-studio/ai',
    fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init),
  ) {
    this.route = route;
    this.fetchImpl = fetchImpl;
  }

  async status(): Promise<AiStatusInfo> {
    let response: Response;
    const doFetch = this.fetchImpl;
    try {
      response = await doFetch(this.route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'ai.status' }),
      });
    } catch {
      return { available: false, provider: '', model: '', models: [] };
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      response.body?.cancel?.().catch(() => undefined);
      return { available: false, provider: '', model: '', models: [] };
    }
    let rawJson: unknown;
    try {
      rawJson = await response.json();
    } catch {
      return { available: false, provider: '', model: '', models: [] };
    }
    const data = recordOf(rawJson);
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
    const doFetch = this.fetchImpl;
    try {
      response = await doFetch(this.route, {
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
    } catch {
      if (request.signal?.aborted) throw new AiClientError('ABORTED', '已取消');
      throw new AiClientError('HOST_UNAVAILABLE', '无法连接宿主 AI 服务');
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      await throwJsonStreamError(response);
    }
    if (!response.ok) {
      response.body?.cancel?.().catch(() => undefined);
      throw httpStatusError(response.status);
    }
    if (!contentType.includes('ndjson')) {
      response.body?.cancel?.().catch(() => undefined);
      throw new AiClientError('HOST_BAD_RESPONSE', '宿主 AI 响应格式异常');
    }
    const acc: StreamAccumulator = { text: '', provider: '', model: '' };
    try {
      await readStreamLines(response, acc, request.onDelta, request.signal);
    } catch (error) {
      if (error instanceof DeltaCallbackError) throw error.cause;
      if (error instanceof AiClientError) throw error;
      if (request.signal?.aborted) throw new AiClientError('ABORTED', '已取消');
      throw new AiClientError('STREAM_INTERRUPTED', '模型输出意外中断，请重试');
    }
    // A stream that ends without its `done` event was cut off: never present partial text
    // as a complete rewrite of the user's selection.
    if (!acc.done) {
      if (request.signal?.aborted) throw new AiClientError('ABORTED', '已取消');
      throw new AiClientError('STREAM_INTERRUPTED', '模型输出意外中断，请重试');
    }
    return { text: acc.text, provider: acc.provider, model: acc.model };
  }
}
