import { UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

export interface AuthenticatedUserPayload {
  id?: string;
  sub: string;
  userId?: string;
  email: string;
  username: string;
  roles: string[];
  is_email_verified: boolean;
  [key: string]: unknown;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUserPayload;
  userId?: string;
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
