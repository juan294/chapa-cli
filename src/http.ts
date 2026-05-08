import { normalizeErrorCauseChain } from "./shared.js";

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

function toRequestFailure(error: unknown, timeoutMs: number): RequestFailure {
  const err = error instanceof Error ? error : new Error(String(error));
  const normalized = normalizeErrorCauseChain(err);

  if (err.name === "TimeoutError") {
    return {
      ok: false,
      category: "timeout",
      message: `Request timed out after ${timeoutMs}ms`,
      detail: normalized.rootMessage,
      chain: normalized.chain,
    };
  }

  return {
    ok: false,
    category: "network",
    message: normalized.detail || normalized.rootMessage || err.message || "Network request failed",
    detail: normalized.rootMessage,
    chain: normalized.chain,
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

function isLocalUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

async function makeRequest(
  opts: RequestOptions<unknown>,
): Promise<RequestResult<Response>> {
  const headers = { ...(opts.headers ?? {}) };
  if (opts.token) {
    if (!opts.url.startsWith("https://") && !isLocalUrl(opts.url)) {
      return {
        ok: false,
        category: "network",
        message: "Refusing to send credentials over non-HTTPS connection.",
      };
    }
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
