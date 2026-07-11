import { ForbiddenException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { CSRF_COOKIE_NAME } from './csrf.constants';
import { csrfProtectionMiddleware } from './csrf.middleware';

describe('csrfProtectionMiddleware', () => {
  const originalJwtSecret = process.env.JWT_SECRET;

  afterEach(() => {
    process.env.JWT_SECRET = originalJwtSecret;
  });

  function createResponse(): Response {
    return {
      cookie: jest.fn(),
    } as unknown as Response;
  }

  function createNext(): NextFunction {
    return jest.fn() as unknown as NextFunction;
  }

  it('should skip CSRF validation for ESP registration with code', () => {
    const request = {
      method: 'POST',
      path: '/devices/verify-registration-code',
      headers: {},
      cookies: {},
    } as unknown as Request;
    const response = createResponse();
    const next = createNext();

    csrfProtectionMiddleware(request, response, next);

    expect(response.cookie).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('should still require CSRF validation for other device POST routes', () => {
    process.env.JWT_SECRET = 'test-secret';
    const request = {
      method: 'POST',
      path: '/devices/register',
      headers: {},
      cookies: {},
    } as unknown as Request;
    const response = createResponse();
    const next = createNext();

    csrfProtectionMiddleware(request, response, next);

    expect(response.cookie).toHaveBeenCalledWith(
      CSRF_COOKIE_NAME,
      expect.any(String),
      expect.objectContaining({ path: '/' })
    );
    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenException));
  });
});
