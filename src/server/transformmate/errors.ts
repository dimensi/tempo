import 'server-only';
import type { RawResponse } from '@/server/transformmate/types';

export class TransformMateApiError extends Error implements RawResponse {
  readonly status: number;
  readonly statusText: string;
  readonly retryAfterMs?: number;
  readonly contentType: string;
  readonly isJson: boolean;
  readonly body: unknown;

  constructor(response: RawResponse) {
    super(`TransformMate HTTP ${response.status}`);
    this.name = 'TransformMateApiError';
    this.status = response.status;
    this.statusText = response.statusText;
    this.retryAfterMs = response.retryAfterMs;
    this.contentType = response.contentType;
    this.isJson = response.isJson;
    this.body = response.body;
  }
}

export class FirebaseRefreshError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number | null,
    public readonly body: unknown = null,
  ) {
    super(
      `Firebase refresh failed: ${code}${status === null ? '' : ` (HTTP ${status})`}`,
    );
    this.name = 'FirebaseRefreshError';
  }
}

export class TransformMateResponseError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly status: number,
  ) {
    super(
      `TransformMate response contract mismatch: ${endpoint} (HTTP ${status})`,
    );
    this.name = 'TransformMateResponseError';
  }
}
