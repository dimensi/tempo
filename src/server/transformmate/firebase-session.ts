import 'server-only';
import { FirebaseRefreshError } from '@/server/transformmate/errors';
import { createSecretRedactor } from '@/server/transformmate/redaction';
import type { TransformMateTokenProvider } from '@/server/transformmate/types';

export interface FirebaseSessionInfo {
  expiresIn: number;
  expiresAt: number;
  userId: string;
  projectId: string;
  refreshTokenRotated: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export class FirebaseSession implements TransformMateTokenProvider {
  #apiKey: string;
  #refreshToken: string;
  #idToken: string | undefined;
  #info: FirebaseSessionInfo | null = null;
  #pending: Promise<string> | undefined;
  #fetch: typeof fetch;
  #onRefreshToken?: (
    token: string,
    info: FirebaseSessionInfo,
  ) => Promise<void> | void;
  #redactor: ReturnType<typeof createSecretRedactor>;

  constructor(options: {
    firebaseApiKey: string;
    refreshToken: string;
    fetch?: typeof fetch;
    onRefreshToken?: (
      newRefreshToken: string,
      info: FirebaseSessionInfo,
    ) => Promise<void> | void;
  }) {
    if (!options.firebaseApiKey.trim() || !options.refreshToken.trim()) {
      throw new FirebaseRefreshError('MISSING_CONFIGURATION', null);
    }
    this.#apiKey = options.firebaseApiKey;
    this.#refreshToken = options.refreshToken;
    this.#fetch = options.fetch ?? fetch;
    this.#onRefreshToken = options.onRefreshToken;
    this.#redactor = createSecretRedactor([this.#apiKey, this.#refreshToken]);
  }

  redact = (text: string) => this.#redactor.text(text);

  /** Secret: for future persistence only; never log or serialize this value. */
  getRefreshToken(): string {
    return this.#refreshToken;
  }

  getSessionInfo(): FirebaseSessionInfo | null {
    return this.#info ? { ...this.#info } : null;
  }

  async getIdToken(options: { forceRefresh?: boolean } = {}): Promise<string> {
    if (this.#pending) return this.#pending;
    if (
      !options.forceRefresh &&
      this.#idToken &&
      this.#info &&
      this.#info.expiresAt - Date.now() > 60_000
    ) {
      return this.#idToken;
    }
    this.#pending = this.#refresh();
    try {
      return await this.#pending;
    } finally {
      this.#pending = undefined;
    }
  }

  async #refresh(): Promise<string> {
    let response: Response;
    let payload: unknown;
    try {
      const url = new URL('https://securetoken.googleapis.com/v1/token');
      url.searchParams.set('key', this.#apiKey);
      response = await this.#fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.#refreshToken,
        }).toString(),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = text;
      }
    } catch {
      throw new FirebaseRefreshError('NETWORK_ERROR', null);
    }
    if (!response.ok) {
      const message =
        record(payload) && record(payload.error)
          ? payload.error.message
          : undefined;
      const code =
        typeof message === 'string'
          ? /api.?key.*(?:not valid|invalid)/i.test(message)
            ? 'INVALID_API_KEY'
            : this.redact(message.split(':')[0]?.trim() || 'UNKNOWN_ERROR')
          : 'UNKNOWN_ERROR';
      throw new FirebaseRefreshError(
        code,
        response.status,
        this.#redactor.body(payload),
      );
    }
    if (
      !record(payload) ||
      typeof payload.id_token !== 'string' ||
      !payload.id_token ||
      /\s/.test(payload.id_token) ||
      typeof payload.expires_in !== 'string' ||
      !/^\d+$/.test(payload.expires_in) ||
      typeof payload.user_id !== 'string' ||
      typeof payload.project_id !== 'string' ||
      (payload.refresh_token !== undefined &&
        (typeof payload.refresh_token !== 'string' ||
          !payload.refresh_token.trim()))
    ) {
      throw new FirebaseRefreshError('INVALID_RESPONSE', response.status);
    }
    const expiresIn = Number(payload.expires_in);
    const expiresAt = Date.now() + expiresIn * 1000;
    if (
      !Number.isSafeInteger(expiresIn) ||
      expiresIn <= 0 ||
      !Number.isSafeInteger(expiresAt)
    ) {
      throw new FirebaseRefreshError('INVALID_RESPONSE', response.status);
    }
    const rotated =
      typeof payload.refresh_token === 'string' &&
      payload.refresh_token !== this.#refreshToken;
    const nextRefreshToken =
      typeof payload.refresh_token === 'string'
        ? payload.refresh_token
        : this.#refreshToken;
    this.#redactor.add(payload.id_token);
    this.#redactor.add(nextRefreshToken);
    const nextInfo: FirebaseSessionInfo = {
      expiresIn,
      expiresAt,
      userId: payload.user_id,
      projectId: payload.project_id,
      refreshTokenRotated:
        rotated || (this.#info?.refreshTokenRotated ?? false),
    };
    // Persistence is part of refresh before publishing rotated credentials.
    // A rejected callback must never publish an ID token or advance local credentials.
    if (rotated && this.#onRefreshToken) {
      try {
        await this.#onRefreshToken(nextRefreshToken, nextInfo);
      } catch {
        throw new FirebaseRefreshError('PERSISTENCE_CALLBACK_FAILED', null);
      }
    }
    this.#refreshToken = nextRefreshToken;
    this.#idToken = payload.id_token;
    this.#info = nextInfo;
    return this.#idToken;
  }
}
