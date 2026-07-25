export class ApiError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(`HTTP ${status}: ${body}`);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(opts: {
  base: string;
  path: string;
  method?: string;
  apiKey: string;
  body?: unknown;
  fetchImpl?: typeof fetch;
}): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${opts.base.replace(/\/$/, "")}${opts.path}`;
  const res = await fetchImpl(url, {
    method: opts.method ?? "GET",
    headers: {
      "X-Api-Key": opts.apiKey,
      Accept: "application/json",
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(res.status, text);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(res.status, `Invalid JSON: ${text.slice(0, 200)}`);
  }
}
