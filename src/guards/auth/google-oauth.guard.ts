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

@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithCookies>();
    const response = context.switchToHttp().getResponse<Response>();
    const state =
      typeof request.query.state === 'string' ? request.query.state : undefined;
    const cookieState = request.cookies?.[GOOGLE_OAUTH_STATE_COOKIE];
    const googleError =
      typeof request.query.error === 'string' ? request.query.error : undefined;

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
