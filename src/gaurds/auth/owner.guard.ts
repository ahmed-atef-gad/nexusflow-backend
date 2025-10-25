import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_OWNER_CHECK_KEY } from '../../auth/decorators/owner.decorator'; // Assuming you use this decorator

// Define the structure of the JWT claims (request.user)
interface AuthUserClaims {
  email: string;
  sub: string; // 🔑 User ID is here (matching your payload)
  roles: string[];
}

@Injectable()
export class OwnerGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isOwnerCheckRequired = this.reflector.get<boolean>(
      IS_OWNER_CHECK_KEY,
      context.getHandler(),
    );
    
    // 1. Check if the @IsOwner() decorator is even used
    if (!isOwnerCheckRequired) {
      return true;
    }

    const request: Request = context.switchToHttp().getRequest();
    
    // 2. Extract the user claims (JWT payload)
    // This relies on your AuthGuard setting request['user'] = payload
    const user = request.user as AuthUserClaims; 
    
    // 3. Get the ID from the URL parameter (e.g., /resource/123)
    const resourceIdParam = request.params.id; 

    // Defensive Checks (Should be caught by AuthGuard, but good practice)
    if (!user || !user.sub) {
      throw new ForbiddenException('Authentication data (User ID) is missing.');
    }
    if (!resourceIdParam) {
      // Log this as a configuration issue
      console.error(`OwnerGuard: Route missing 'id' parameter in URL for ${request.url}`);
      return false; 
    }

    // 4. Perform the ID Comparison
    // Both IDs (user.sub and resourceIdParam) are treated as strings.
    // If your IDs are MongoDB ObjectIDs, string comparison is correct.
    const authenticatedUserId = user.sub; // 🔑 Extracted from the 'sub' claim
    const resourceId = resourceIdParam;
    
    const isOwner = authenticatedUserId === resourceId;

    if (!isOwner) {
      throw new ForbiddenException('Access to this resource is restricted: You must be the owner.');
    }

    return true;
  }
}