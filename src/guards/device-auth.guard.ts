/**
 * DeviceAuthGuard
 *
 * Guards that authenticates incoming requests using device tokens.
 * Validates the Bearer token from the Authorization header and ensures
 * the device is active and valid.
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DevicesService } from '../devices/devices.service';
import type { Request } from 'express';
import { DeviceDocument } from '../devices/schemas/device.schema';

interface DeviceAuthRequest extends Request {
  headers: Request['headers'] & { authorization?: string };
  query: Request['query'] & { token?: string | string[] };
  device?: DeviceDocument;
  deviceToken?: string;
}

@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private devicesService: DevicesService) {}

  /**
   * Validates the device token from the request headers
   *
   * @param context - The execution context containing the request
   * @returns true if device is authenticated and active, otherwise throws UnauthorizedException
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Extract the HTTP request object from the execution context
    const request = context.switchToHttp().getRequest<DeviceAuthRequest>();

    // Retrieve the Authorization header
    const authHeader = request.headers.authorization;
    const queryToken =
      typeof request.query?.token === 'string' ? request.query.token : null;

    let token: string | null = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (queryToken) {
      token = queryToken;
    }

    if (!token) {
      throw new UnauthorizedException('Missing Device Token');
    }

    // Validate the token against the database
    const device = await this.devicesService.validateToken(token);

    // Reject if token is invalid or not found
    if (!device) {
      throw new UnauthorizedException('Invalid or Revoked Device Token');
    }

    // Reject if the device has been revoked
    if (device.status === 'revoked') {
      throw new UnauthorizedException('Device is revoked');
    }

    // Attach the validated device object to the request for downstream use
    request.device = device;
    request.deviceToken = token;

    // Grant access if all validations pass
    return true;
  }
}
