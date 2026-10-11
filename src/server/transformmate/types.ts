export interface TransformMateTokenProvider {
  getIdToken(options?: { forceRefresh?: boolean }): Promise<string>;
  /** Sanitizes additional provider credentials that an upstream might echo. */
  redact?(text: string): string;
}

/** Transport metadata only; the upstream domain contract remains unknown. */
export interface RawResponse {
  status: number;
  statusText: string;
  contentType: string;
  isJson: boolean;
  body: unknown;
}
