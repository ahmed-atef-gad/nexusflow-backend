import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  GOOGLE_OAUTH_STATE_COOKIE,
  parseGoogleOAuthState,
} from '../utils/oauth-state.util';

function getCookieValue(cookies: unknown, key: string): string | undefined {
  if (!cookies || typeof cookies !== 'object') {
    return undefined;
  }

  const value = (cookies as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Exception filter for the Google OAuth callback endpoint.
 * Instead of returning JSON error responses (which would show raw JSON in the browser),
 * this filter redirects to the frontend with an error query parameter.
 */
@Catch()
export class GoogleOAuthExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<
      Request & { cookies?: Record<string, string | undefined> }
    >();
    const response = ctx.getResponse<Response>();

    const corsOrigins = process.env.CORS_ORIGINS || '';
    const frontendUrl =
      corsOrigins.split(',')[0]?.trim() || 'http://localhost:8080';

    let errorCode = 'google_auth_failed';

    if (exception instanceof UnauthorizedException) {
      const message =
        typeof exception.message === 'string'
          ? exception.message.toLowerCase()
          : '';

      if (message.includes('cancelled') || message.includes('canceled')) {
        errorCode = 'google_cancelled';
      } else if (message.includes('disabled')) {
        errorCode = 'account_disabled';
      }
    }

    const queryStateValue: unknown = request.query?.state;
    const queryState =
      typeof queryStateValue === 'string' ? queryStateValue : undefined;
    const cookieState = getCookieValue(
      request.cookies,
      GOOGLE_OAUTH_STATE_COOKIE
    );
    const trustedState =
      queryState && cookieState && queryState === cookieState
        ? parseGoogleOAuthState(queryState)
        : null;
    const mobileRedirectUri = process.env.GOOGLE_MOBILE_REDIRECT_URI;
    const shouldRedirectToMobile =
      trustedState?.client === 'mobile' && !!mobileRedirectUri;

    const errorUrl = shouldRedirectToMobile
      ? new URL(mobileRedirectUri)
      : new URL('/auth/google/callback', frontendUrl);
    errorUrl.searchParams.set('error', errorCode);
    response.redirect(errorUrl.toString());
  }
}
