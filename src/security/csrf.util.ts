import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { CookieOptions, Request, Response } from 'express';
import {
  CSRF_ALTERNATE_HEADER_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from './csrf.constants';
import { getCrossSiteCookieOptions } from './cookie-options.util';

const CSRF_TOKEN_BYTES = 32;
const CSRF_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const CSRF_RESPONSE_LOCAL_KEY = 'csrfToken';

type RequestWithCookies = Request & {
  cookies?: Record<string, string | undefined>;
};

function rememberCsrfToken(response: Response, token: string): void {
  if (response.locals) {
    response.locals[CSRF_RESPONSE_LOCAL_KEY] = token;
  }
}

function getCsrfSecret(): string {
  const secret = process.env.CSRF_SECRET ?? process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      'CSRF_SECRET or JWT_SECRET environment variable is not set'
    );
  }
  return secret;
}

function signCsrfNonce(nonce: string): string {
  return createHmac('sha256', getCsrfSecret())
    .update(nonce)
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

export function createCsrfToken(): string {
  const nonce = randomBytes(CSRF_TOKEN_BYTES).toString('base64url');
  return `${nonce}.${signCsrfNonce(nonce)}`;
}

export function isValidCsrfToken(token: string | undefined): token is string {
  if (!token) return false;

  const [nonce, signature, extra] = token.split('.');
  if (!nonce || !signature || extra !== undefined) return false;

  return safeCompare(signature, signCsrfNonce(nonce));
}

export function getCsrfCookieOptions(): CookieOptions {
  return {
    httpOnly: false,
    maxAge: CSRF_COOKIE_MAX_AGE_MS,
    path: '/',
    ...getCrossSiteCookieOptions(),
  };
}

export function getCsrfCookieValue(
  request: RequestWithCookies
): string | undefined {
  const cookies = request.cookies as Record<string, string | undefined>;
  return cookies?.[CSRF_COOKIE_NAME];
}

export function getCsrfHeaderValue(request: Request): string | undefined {
  const header =
    request.headers[CSRF_HEADER_NAME] ??
    request.headers[CSRF_ALTERNATE_HEADER_NAME];

  if (Array.isArray(header)) return header[0];
  return header;
}

export function setCsrfCookie(
  response: Response,
  token = createCsrfToken()
): string {
  response.cookie(CSRF_COOKIE_NAME, token, getCsrfCookieOptions());
  return token;
}

export function ensureCsrfCookie(
  request: RequestWithCookies,
  response: Response
): string {
  const existingToken = getCsrfCookieValue(request);
  if (isValidCsrfToken(existingToken)) {
    rememberCsrfToken(response, existingToken);
    return existingToken;
  }

  const token = setCsrfCookie(response);
  rememberCsrfToken(response, token);
  return token;
}

export function clearCsrfCookie(response: Response): void {
  response.clearCookie(CSRF_COOKIE_NAME, getCsrfCookieOptions());
}

export function isCsrfRequestValid(request: RequestWithCookies): boolean {
  const cookieToken = getCsrfCookieValue(request);
  const headerToken = getCsrfHeaderValue(request);

  return (
    isValidCsrfToken(cookieToken) &&
    isValidCsrfToken(headerToken) &&
    safeCompare(cookieToken, headerToken)
  );
}
