const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4300/api';

export interface ApiErrorDetail {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ApiErrorDetail[] | unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level messages, ready to hand to react-hook-form. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries(
      (this.details as ApiErrorDetail[])
        .filter((d) => d && typeof d.field === 'string')
        .map((d) => [d.field, d.message]),
    );
  }
}

type QueryValue = string | number | boolean | null | undefined | string[];

export function buildQuery(params: Record<string, QueryValue> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach((item) => search.append(key, String(item)));
    } else {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  raw?: boolean;
}

async function parseError(response: Response): Promise<ApiError> {
  let payload: { error?: { code?: string; message?: string; details?: unknown } } = {};
  try {
    payload = await response.json();
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(
    response.status,
    payload.error?.code ?? 'REQUEST_FAILED',
    payload.error?.message ?? `Request failed with status ${response.status}`,
    payload.error?.details,
  );
}

/** Session cookie travels with every call; 401 clears the cached session. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, raw, headers, ...rest } = options;

  const isFormData = body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(isFormData ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await parseError(response);
    if (error.status === 401 && !path.startsWith('/auth/')) {
      window.dispatchEvent(new CustomEvent('ashram:session-expired'));
    }
    throw error;
  }

  if (raw) return response as unknown as T;
  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return (await response.text()) as unknown as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: 'DELETE' }),
};

/**
 * Downloads a file through the authenticated API and hands it to the browser.
 * Used by every PDF / Excel / CSV export button.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(`${API_URL}${path}`, { credentials: 'include' });
  if (!response.ok) throw await parseError(response);

  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const fileName = match?.[1] ?? fallbackName;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function fileUrl(path: string): string {
  return `${API_URL}${path}`;
}
