export type RequestFailureCategory =
  | "timeout"
  | "network"
  | "http"
  | "parse";

export interface RequestFailure {
  ok: false;
  category: RequestFailureCategory;
  message: string;
  status?: number;
  body?: unknown;
  text?: string;
  detail?: string;
  chain?: string;
}

export interface RequestSuccess<T> {
  ok: true;
  status: number;
  data: T;
}

export type RequestResult<T> = RequestSuccess<T> | RequestFailure;

interface RequestOptions<TFallback> {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  token?: string;
  body?: BodyInit | object;
  timeoutMs?: number;
  fallbackData?: TFallback;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function getRootMessage(err: Error): string {
  let current: unknown = err;
  let message = "";
  while (current instanceof Error) {
    message = current.message;
    current = (current as Error & { cause?: unknown }).cause;
  }
  return message;
}

function getDetailedMessage(err: Error): string {
  const parts = [err.message];
  let current: unknown = err.cause;
  while (current instanceof Error) {
    if (current.message && current.message !== parts[parts.length - 1]) {
      parts.push(current.message);
    }
    current = current.cause;
  }
  return parts.join(" → ");
}

function getErrorChain(err: Error): string {
  const parts: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    parts.push(current.message);
    const code = (current as Error & { code?: string }).code;
    if (code) {
      parts.push(code);
    }
    current = (current as Error & { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

function toRequestFailure(error: unknown, timeoutMs: number): RequestFailure {
  const err = error instanceof Error ? error : new Error(String(error));
  const detail = getRootMessage(err);
  const chain = getErrorChain(err);

  if (err.name === "TimeoutError") {
    return {
      ok: false,
      category: "timeout",
      message: `Request timed out after ${timeoutMs}ms`,
      detail,
      chain,
    };
  }

  return {
    ok: false,
    category: "network",
    message: getDetailedMessage(err) || detail || err.message || "Network request failed",
    detail,
    chain,
  };
}

function normalizeBody(
  body: BodyInit | object | undefined,
  headers: Record<string, string>,
): BodyInit | undefined {
  if (body == null) {
    return undefined;
  }

  if (typeof body === "string" || body instanceof URLSearchParams) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return body as unknown as BodyInit;
  }

  if (!("Content-Type" in headers) && !("content-type" in headers)) {
    headers["Content-Type"] = "application/json";
  }

  return JSON.stringify(body);
}

function parseBodyText(raw: string): { body?: unknown; text?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  try {
    return { body: JSON.parse(trimmed) };
  } catch {
    return { text: raw };
  }
}

async function makeRequest(
  opts: RequestOptions<unknown>,
): Promise<RequestResult<Response>> {
  const headers = { ...(opts.headers ?? {}) };
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const response = await fetch(opts.url, {
      method: opts.method ?? "GET",
      headers,
      body: normalizeBody(opts.body, headers),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const raw = await response.text().catch(() => "(unreadable)");
      return {
        ok: false,
        category: "http",
        status: response.status,
        message: `HTTP ${response.status}`,
        ...parseBodyText(raw),
      };
    }

    return {
      ok: true,
      status: response.status,
      data: response,
    };
  } catch (error) {
    return toRequestFailure(error, timeoutMs);
  }
}

export async function requestJson<T>(
  opts: RequestOptions<T>,
): Promise<RequestResult<T>> {
  const response = await makeRequest(opts);
  if (!response.ok) {
    return response;
  }

  const raw = await response.data.text().catch(() => "");
  if (!raw.trim()) {
    if (opts.fallbackData !== undefined) {
      return {
        ok: true,
        status: response.status,
        data: opts.fallbackData,
      };
    }

    return {
      ok: false,
      category: "parse",
      status: response.status,
      message: "Invalid JSON response",
      text: raw,
    };
  }

  try {
    return {
      ok: true,
      status: response.status,
      data: JSON.parse(raw) as T,
    };
  } catch {
    if (opts.fallbackData !== undefined) {
      return {
        ok: true,
        status: response.status,
        data: opts.fallbackData,
      };
    }

    return {
      ok: false,
      category: "parse",
      status: response.status,
      message: "Invalid JSON response",
      text: raw,
    };
  }
}

export async function requestText(
  opts: RequestOptions<string>,
): Promise<RequestResult<string>> {
  const response = await makeRequest(opts);
  if (!response.ok) {
    return response;
  }

  return {
    ok: true,
    status: response.status,
    data: await response.data.text().catch(() => ""),
  };
}
