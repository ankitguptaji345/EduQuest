import { useAuthStore } from '../store/useAuthStore';

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: Record<string, unknown> | null;
  public readonly requestId: string;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> | null = null,
    requestId = '',
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export function xpRequiredForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(100 * Math.pow(level, 1.5));
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { idempotent?: boolean } = {},
): Promise<T> {
  const token = useAuthStore.getState().token;
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (options.idempotent && !headers.has('Idempotency-Key')) {
    headers.set('Idempotency-Key', crypto.randomUUID());
  }

  const res = await fetch(path, { ...options, headers });

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new ApiError(res.status, 'INVALID_RESPONSE', text);
    }
  }

  if (!res.ok) {
    const errObj = json.error as
      | { code?: string; message?: string; details?: Record<string, unknown> | null; request_id?: string }
      | undefined;

    if (res.status === 401 && !path.startsWith('/api/auth/')) {
      useAuthStore.getState().logout();
    }

    throw new ApiError(
      res.status,
      errObj?.code || 'REQUEST_FAILED',
      errObj?.message || `Request failed with status ${res.status}`,
      errObj?.details || null,
      errObj?.request_id || '',
    );
  }

  return json as T;
}

// Blueprint C7: XMLHttpRequest upload so real byte-level progress % is reported
export function uploadDocumentWithProgress(
  params: { file: File; title?: string; subjectId?: string },
  onProgress: (percent: number) => void,
): Promise<{
  document: Record<string, unknown>;
  job: Record<string, unknown>;
  duplicate_warning: { existing_document_id: string; existing_title: string; message: string } | null;
}> {
  return new Promise((resolve, reject) => {
    const token = useAuthStore.getState().token;
    const formData = new FormData();
    formData.append('file', params.file);
    if (params.title) formData.append('title', params.title);
    if (params.subjectId) formData.append('subject_id', params.subjectId);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/documents/upload', true);
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const parsed = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(parsed);
        } else {
          const e = parsed.error || {};
          reject(
            new ApiError(
              xhr.status,
              e.code || 'UPLOAD_FAILED',
              e.message || `Upload failed (${xhr.status})`,
              e.details || null,
              e.request_id || '',
            ),
          );
        }
      } catch {
        reject(new ApiError(xhr.status, 'UPLOAD_FAILED', 'Unexpected response from server.'));
      }
    };

    xhr.onerror = () => {
      reject(new ApiError(0, 'NETWORK_ERROR', 'Network error occurred during upload.'));
    };

    xhr.send(formData);
  });
}
