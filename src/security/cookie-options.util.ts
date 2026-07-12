import type { CookieOptions } from 'express';

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return undefined;
}

function isLocalHttpUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function hasLocalHttpCorsOrigin(): boolean {
  return (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .some(isLocalHttpUrl);
}

export function shouldUseSecureCookies(): boolean {
  const explicitCookieSecure = parseBooleanEnv(process.env.COOKIE_SECURE);
  if (explicitCookieSecure !== undefined) return explicitCookieSecure;
  if (process.env.NODE_ENV === 'production') return true;
  if (isLocalHttpUrl(process.env.GOOGLE_CALLBACK) || hasLocalHttpCorsOrigin()) {
    return false;
  }
  return true;
}

export function getCrossSiteCookieOptions(): Pick<
  CookieOptions,
  'sameSite' | 'secure'
> {
  const secure = shouldUseSecureCookies();
  return {
    secure,
    sameSite: secure ? 'none' : 'lax',
  };
}
