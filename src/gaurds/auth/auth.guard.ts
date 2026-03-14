import {
  CanActivate,
  ExecutionContext,
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
      const tokenVersion = await this.usersService.getTokenVersionById(
        payload.sub
      );
      if (tokenVersion === null || payload.token_version !== tokenVersion) {
        throw new UnauthorizedException();
      }
      // Assign the payload so route handlers can access it
      request.user = payload;
      request.userId = getUserIdFromRequest(request);
    } catch {
      throw new UnauthorizedException();
    }
    return true;
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
