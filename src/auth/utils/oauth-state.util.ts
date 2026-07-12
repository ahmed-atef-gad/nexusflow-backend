import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { CookieOptions, Response } from 'express';
import { shouldUseSecureCookies } from '../../security/cookie-options.util';

export const GOOGLE_OAUTH_STATE_COOKIE = 'google_oauth_state';

const STATE_BYTES = 32;
const STATE_TTL_MS = 10 * 60 * 1000;

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

export function createGoogleOAuthState(): string {
  const nonce = randomBytes(STATE_BYTES).toString('base64url');
  const issuedAt = Date.now().toString(36);
  const payload = `${nonce}.${issuedAt}`;
  return `${payload}.${signStatePayload(payload)}`;
}

export function isValidGoogleOAuthState(state: string | undefined): boolean {
  if (!state) return false;

  const parts = state.split('.');
  if (parts.length !== 3) return false;

  const [nonce, issuedAt, signature] = parts;
  if (!nonce || !issuedAt || !signature) return false;

  const issuedAtMs = Number.parseInt(issuedAt, 36);
  if (!Number.isFinite(issuedAtMs)) return false;

  const now = Date.now();
  if (issuedAtMs > now || now - issuedAtMs > STATE_TTL_MS) return false;

  return safeCompare(signature, signStatePayload(`${nonce}.${issuedAt}`));
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
