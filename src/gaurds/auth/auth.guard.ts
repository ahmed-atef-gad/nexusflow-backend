import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from 'src/users/users.service';
import {
  AuthenticatedRequest,
  AuthenticatedUserPayload,
  getUserIdFromRequest,
} from '../../auth/utils/auth.util';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly unverifiedAllowedPrefixes = ['/auth', '/verification'];

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private usersService: UsersService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException();
    }
    try {
      const payload =
        await this.jwtService.verifyAsync<AuthenticatedUserPayload>(token, {
          secret: this.configService.get<string>('JWT_SECRET'),
        });
      const authState = await this.usersService.getAuthStateById(
        payload.sub
      );
      if (
        authState === null ||
        payload.token_version !== authState.tokenVersion
      ) {
        throw new UnauthorizedException();
      }
      const requestPath = this.getRequestPath(request);
      const isAllowedForUnverified = this.unverifiedAllowedPrefixes.some(
        (prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`)
      );
      if (!authState.emailVerified && !isAllowedForUnverified) {
        throw new ForbiddenException(
          'Email is not verified. Please verify your email first.'
        );
      }
      // Assign the payload so route handlers can access it
      request.user = payload;
      request.userId = getUserIdFromRequest(request);
    } catch {
      throw new UnauthorizedException();
    }
    return true;
  }

  private getRequestPath(request: AuthenticatedRequest): string {
    const pathCandidate = (request.path ?? request.originalUrl ?? '/').toString();
    return pathCandidate.split('?')[0];
  }

  private extractTokenFromHeader(
    request: AuthenticatedRequest
  ): string | undefined {
    const cookies = request.cookies;
    if (!cookies || !cookies['jwt']) {
      return undefined;
    }
    return cookies['jwt'] as string;
  }
}
