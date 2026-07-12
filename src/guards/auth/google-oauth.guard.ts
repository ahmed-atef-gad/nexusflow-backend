import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import {
  clearGoogleOAuthStateCookie,
  GOOGLE_OAUTH_STATE_COOKIE,
  isValidGoogleOAuthState,
} from '../../auth/utils/oauth-state.util';

type RequestWithCookies = Request & {
  cookies?: Record<string, string | undefined>;
};

function getSingleQueryValue(
  query: unknown,
  key: 'state' | 'error'
): string | undefined {
  if (!query || typeof query !== 'object') {
    return undefined;
  }

  const value = (query as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function getCookieValue(cookies: unknown, key: string): string | undefined {
  if (!cookies || typeof cookies !== 'object') {
    return undefined;
  }

  const value = (cookies as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithCookies>();
    const response = context.switchToHttp().getResponse<Response>();
    const state = getSingleQueryValue(request.query, 'state');
    const cookieState = getCookieValue(
      request.cookies,
      GOOGLE_OAUTH_STATE_COOKIE
    );
    const googleError = getSingleQueryValue(request.query, 'error');

    if (googleError) {
      clearGoogleOAuthStateCookie(response);
      throw new UnauthorizedException('Google authentication was cancelled');
    }

    if (
      !state ||
      !cookieState ||
      state !== cookieState ||
      !isValidGoogleOAuthState(state)
    ) {
      clearGoogleOAuthStateCookie(response);
      throw new UnauthorizedException('Invalid Google OAuth state');
    }

    return (await super.canActivate(context)) as boolean;
  }
}
