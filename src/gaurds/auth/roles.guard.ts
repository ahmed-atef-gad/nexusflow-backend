import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../auth/decorators/roles.decorator';
import { Role } from '../../users/enums/role.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  // Inject the Reflector service to read custom metadata
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. Get the required roles from the route handler/class
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(), // Check method level
      context.getClass(),   // Check class level
    ]);

    // If no @Roles() decorator is present, access is granted by default
    if (!requiredRoles) {
      return true;
    }

    // 2. Get the user object from the request
    // This assumes an AuthGuard (like JWT/Passport) has already run
    // and attached the 'user' object to the request.
    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // 3. Check if the user has any of the required roles
    // We assume 'user' has a 'roles' array property (e.g., user.roles = [Role.Admin])
    const hasRequiredRole = requiredRoles.some((role) =>
      user.roles?.includes(role)
    );
    if (!hasRequiredRole) {
      throw new ForbiddenException('Admin role required');
    }

    return true;
  }
}
