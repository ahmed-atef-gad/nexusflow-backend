import { ForbiddenException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ensureCsrfCookie, isCsrfRequestValid } from './csrf.util';

const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_EXEMPT_ROUTES = new Set([
  'POST /devices/verify-registration-code',
  'POST /devices/register',
]);

function getRouteKey(request: Request): string {
  const path =
    request.path || request.originalUrl?.split('?')[0] || request.url;
  return `${request.method.toUpperCase()} ${path}`;
}

export function csrfProtectionMiddleware(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    // Temporary exemption for ESP firmware registration; re-enable CSRF later.
    if (CSRF_EXEMPT_ROUTES.has(getRouteKey(request))) {
      next();
      return;
    }

    if (SAFE_HTTP_METHODS.has(request.method.toUpperCase())) {
      ensureCsrfCookie(request, response);
      next();
      return;
    }

    if (!isCsrfRequestValid(request)) {
      ensureCsrfCookie(request, response);
      next(new ForbiddenException('Invalid or missing CSRF token'));
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}
