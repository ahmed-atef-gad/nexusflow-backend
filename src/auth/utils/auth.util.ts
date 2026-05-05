import { UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

export const REFRESH_TOKEN_COOKIE = 'refresh_token';

export interface AuthenticatedUserPayload {
  id?: string;
  sub: string;
  userId?: string;
  email: string;
  username: string;
  roles: string[];
  isActive: boolean;
  isEmailVerified: boolean;
  [key: string]: unknown;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUserPayload;
  userId?: string;
  isActive?: boolean;
}

export function getUserIdFromRequest(req: AuthenticatedRequest): string {
  const userId =
    req.userId ?? req.user?.id ?? req.user?.sub ?? req.user?.userId;

  if (!userId) {
    throw new UnauthorizedException('User not authenticated');
  }

  req.userId = userId;
  return userId;
}
