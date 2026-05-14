import { ForbiddenException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ensureCsrfCookie, isCsrfRequestValid } from './csrf.util';

const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfProtectionMiddleware(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
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
