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
    const request = context.switchToHttp().getRequest();

    // Retrieve the Authorization header
    const authHeader = request.headers.authorization;

    // Check if Authorization header exists and follows Bearer token format
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Device Token');
    }

    // Extract the token from the "Bearer <token>" format
    const token = authHeader.split(' ')[1];

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

    // Grant access if all validations pass
    return true;
  }
}
