import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import {
  IS_OWNER_CHECK_KEY,
  OWNER_PARAM_KEY,
  OWNER_RESOURCE_KEY,
  OwnerResource,
} from '../../auth/decorators/owner.decorator';
import { Flow, FlowDocument } from '../../flows/schemas/flow.schema';
import { Device, DeviceDocument } from '../../devices/schemas/device.schema';
import {
  DeviceToken,
  DeviceTokenDocument,
} from '../../devices/schemas/device-token.schema';
import {
  Notification,
  NotificationDocument,
} from '../../notifications/schemas/notification.schema';
import {
  AuthenticatedRequest,
  getUserIdFromRequest,
} from '../../auth/utils/auth.util';
import { Role } from '../../users/enums/role.enum';

@Injectable()
export class OwnerGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectConnection() private readonly connection: Connection
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isOwnerCheckRequired = this.reflector.getAllAndOverride<boolean>(
      IS_OWNER_CHECK_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!isOwnerCheckRequired) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const requestRoles = Array.isArray(request.user?.roles)
      ? request.user.roles
      : [];

    // Owner is a super-role and bypasses resource ownership checks.
    if (requestRoles.includes(Role.Owner)) {
      return true;
    }

    let userId: string;

    try {
      userId = getUserIdFromRequest(request);
    } catch {
      throw new UnauthorizedException(
        'Authentication data (User ID) is missing.'
      );
    }

    const paramKey =
      this.reflector.getAllAndOverride<string>(OWNER_PARAM_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'id';

    const resource =
      this.reflector.getAllAndOverride<OwnerResource>(OWNER_RESOURCE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'user';

    const resourceIdParam =
      request.params?.[paramKey] ??
      request.params?.id ??
      request.params?.userId;

    if (!resourceIdParam) {
      console.error(
        `OwnerGuard: Route missing '${paramKey}' parameter in URL for ${request.url}`
      );
      return false;
    }

    const ownershipResult = await this.checkOwnership(
      resource,
      resourceIdParam,
      userId
    );

    if (!ownershipResult) {
      throw new ForbiddenException(
        'Access to this resource is restricted: You must be the owner.'
      );
    }

    return true;
  }

  private async checkOwnership(
    resource: OwnerResource,
    resourceId: string,
    userId: string
  ): Promise<boolean> {
    if (resource === 'user') {
      return userId === resourceId;
    }

    switch (resource) {
      case 'flow': {
        if (!Types.ObjectId.isValid(resourceId)) return false;
        const FlowModel = this.connection.model<FlowDocument>(Flow.name);
        const flow = await FlowModel.findById(resourceId)
          .select('userId')
          .exec();
        if (!flow) return false;
        return flow.userId?.toString() === userId;
      }
      case 'device': {
        if (!Types.ObjectId.isValid(resourceId)) return false;
        const DeviceModel = this.connection.model<DeviceDocument>(Device.name);
        const device = await DeviceModel.findById(resourceId)
          .select('ownerId')
          .exec();
        if (!device) return false;
        return device.ownerId?.toString() === userId;
      }
      case 'deviceToken': {
        const DeviceTokenModel = this.connection.model<DeviceTokenDocument>(
          DeviceToken.name
        );
        const tokenId = resourceId.includes('.')
          ? resourceId.split('.')[0]
          : resourceId;
        const token = await DeviceTokenModel.findOne({ tokenId })
          .select('deviceId')
          .exec();
        if (!token?.deviceId) return false;
        const DeviceModel = this.connection.model<DeviceDocument>(Device.name);
        const device = await DeviceModel.findById(token.deviceId)
          .select('ownerId')
          .exec();
        if (!device) return false;
        return device.ownerId?.toString() === userId;
      }
      case 'notification': {
        if (!Types.ObjectId.isValid(resourceId)) return false;
        const NotificationModel = this.connection.model<NotificationDocument>(
          Notification.name
        );
        const notification = await NotificationModel.findById(resourceId)
          .select('user_id')
          .exec();
        if (!notification) return false;
        return notification.user_id === userId;
      }
      default:
        return false;
    }
  }
}
