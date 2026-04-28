import { SetMetadata } from '@nestjs/common';
import { Role } from '../../users/enums/role.enum';

// The key used to store and retrieve the roles metadata
export const ROLES_KEY = 'roles';

/**
 * Custom decorator to specify the roles required to access a route.
 * @param roles The array of roles (e.g., [Role.Admin, Role.Moderator])
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
