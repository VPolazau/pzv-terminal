const API_BASE_URL = '/api';

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);

  if (!response.ok) {
    let payload: { code?: string; message?: string } | null = null;
    try {
      payload = (await response.json()) as { code?: string; message?: string };
    } catch {
      // Keep a stable fallback for non-JSON gateway errors.
    }
    const error = new Error(
      payload?.message ?? `API request failed: ${response.status}`,
    ) as Error & {
      code?: string;
    };
    error.code = payload?.code;
    throw error;
  }

  if (response.status === 204 || response.headers.get('content-length') === '0')
    return undefined as T;
  const body = await response.text();
  return (body.trim() ? JSON.parse(body) : undefined) as T;
}
