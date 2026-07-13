import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { CookieOptions, Response } from 'express';
import { shouldUseSecureCookies } from '../../security/cookie-options.util';

export const GOOGLE_OAUTH_STATE_COOKIE = 'google_oauth_state';

const STATE_BYTES = 32;
const STATE_TTL_MS = 10 * 60 * 1000;
export type GoogleOAuthClient = 'web' | 'mobile';

export interface GoogleOAuthStatePayload {
  nonce: string;
  issuedAt: number;
  client: GoogleOAuthClient;
  codeChallenge?: string;
}

interface CreateGoogleOAuthStateOptions {
  client?: GoogleOAuthClient;
  codeChallenge?: string;
}

function getStateSecret(): string {
  const secret =
    process.env.GOOGLE_OAUTH_STATE_SECRET ??
    process.env.CSRF_SECRET ??
    process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'GOOGLE_OAUTH_STATE_SECRET, CSRF_SECRET, or JWT_SECRET must be set'
    );
  }
  return secret;
}

function signStatePayload(payload: string): string {
  return createHmac('sha256', getStateSecret())
    .update(payload)
    .digest('base64url');
}

function safeCompare(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function encodePayload(payload: GoogleOAuthStatePayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodePayload(payload: string): GoogleOAuthStatePayload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    ) as Partial<GoogleOAuthStatePayload>;

    if (
      typeof parsed.nonce !== 'string' ||
      typeof parsed.issuedAt !== 'number' ||
      (parsed.client !== 'web' && parsed.client !== 'mobile')
    ) {
      return null;
    }

    if (
      parsed.codeChallenge !== undefined &&
      typeof parsed.codeChallenge !== 'string'
    ) {
      return null;
    }

    return parsed as GoogleOAuthStatePayload;
  } catch {
    return null;
  }
}

function parseLegacyState(state: string): GoogleOAuthStatePayload | null {
  const parts = state.split('.');
  if (parts.length !== 3) return null;

  const [nonce, issuedAt] = parts;
  if (!nonce || !issuedAt) return null;

  const issuedAtMs = Number.parseInt(issuedAt, 36);
  if (!Number.isFinite(issuedAtMs)) return null;

  return {
    nonce,
    issuedAt: issuedAtMs,
    client: 'web',
  };
}

export function createGoogleOAuthState(
  options: CreateGoogleOAuthStateOptions = {}
): string {
  const payload = encodePayload({
    nonce: randomBytes(STATE_BYTES).toString('base64url'),
    issuedAt: Date.now(),
    client: options.client ?? 'web',
    codeChallenge: options.codeChallenge,
  });
  return `${payload}.${signStatePayload(payload)}`;
}

export function parseGoogleOAuthState(
  state: string | undefined
): GoogleOAuthStatePayload | null {
  if (!state) return null;

  const parts = state.split('.');
  const isLegacyState = parts.length === 3;
  const payload = isLegacyState ? `${parts[0]}.${parts[1]}` : parts[0];
  const signature = isLegacyState ? parts[2] : parts[1];
  if (!payload || !signature || parts.length < 2 || parts.length > 3) {
    return null;
  }

  if (!safeCompare(signature, signStatePayload(payload))) {
    return null;
  }

  const parsed = isLegacyState
    ? parseLegacyState(state)
    : decodePayload(payload);
  if (!parsed) return null;

  const now = Date.now();
  if (parsed.issuedAt > now || now - parsed.issuedAt > STATE_TTL_MS) {
    return null;
  }

  return parsed;
}

export function isValidGoogleOAuthState(state: string | undefined): boolean {
  return parseGoogleOAuthState(state) !== null;
}

export function getGoogleOAuthStateCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    maxAge: STATE_TTL_MS,
    path: '/auth/google',
    sameSite: 'lax',
    secure: shouldUseSecureCookies(),
  };
}

export function clearGoogleOAuthStateCookie(response: Response): void {
  response.clearCookie(
    GOOGLE_OAUTH_STATE_COOKIE,
    getGoogleOAuthStateCookieOptions()
  );
}
