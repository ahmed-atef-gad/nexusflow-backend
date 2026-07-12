import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Exception filter for the Google OAuth callback endpoint.
 * Instead of returning JSON error responses (which would show raw JSON in the browser),
 * this filter redirects to the frontend with an error query parameter.
 */
@Catch()
export class GoogleOAuthExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
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

    const errorUrl = new URL('/auth/google/callback', frontendUrl);
    errorUrl.searchParams.set('error', errorCode);
    response.redirect(errorUrl.toString());
  }
}
