import { ForbiddenException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { CSRF_COOKIE_NAME } from './csrf.constants';
import { csrfProtectionMiddleware } from './csrf.middleware';

describe('csrfProtectionMiddleware', () => {
  const originalJwtSecret = process.env.JWT_SECRET;

  afterEach(() => {
    if (originalJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
      return;
    }

    process.env.JWT_SECRET = originalJwtSecret;
  });

  function createResponse(): {
    response: Response;
    cookieMock: jest.Mock;
  } {
    const cookieMock = jest.fn();
    return {
      response: {
        cookie: cookieMock,
      } as unknown as Response,
      cookieMock,
    };
  }

  function createNext(): {
    next: NextFunction;
    nextMock: jest.Mock;
  } {
    const nextMock = jest.fn();
    return {
      next: nextMock as unknown as NextFunction,
      nextMock,
    };
  }

  it('should skip CSRF validation for ESP registration with code', () => {
    const request = {
      method: 'POST',
      path: '/devices/verify-registration-code',
      headers: {},
      cookies: {},
    } as unknown as Request;
    const { response, cookieMock } = createResponse();
    const { next, nextMock } = createNext();

    csrfProtectionMiddleware(request, response, next);

    expect(cookieMock).not.toHaveBeenCalled();
    expect(nextMock).toHaveBeenCalledWith();
  });

  it('should skip CSRF validation for refresh because it bootstraps sessions', () => {
    const request = {
      method: 'POST',
      path: '/auth/refresh',
      headers: {},
      cookies: {},
    } as unknown as Request;
    const { response, cookieMock } = createResponse();
    const { next, nextMock } = createNext();

    csrfProtectionMiddleware(request, response, next);

    expect(cookieMock).not.toHaveBeenCalled();
    expect(nextMock).toHaveBeenCalledWith();
  });

  it('should still require CSRF validation for other device POST routes', () => {
    process.env.JWT_SECRET = 'test-secret';
    const request = {
      method: 'POST',
      path: '/devices/update',
      headers: {},
      cookies: {},
    } as unknown as Request;
    const { response, cookieMock } = createResponse();
    const { next, nextMock } = createNext();

    csrfProtectionMiddleware(request, response, next);

    expect(cookieMock).toHaveBeenCalledWith(
      CSRF_COOKIE_NAME,
      expect.any(String),
      expect.objectContaining({ path: '/' })
    );
    expect(nextMock).toHaveBeenCalledWith(expect.any(ForbiddenException));
  });
});
