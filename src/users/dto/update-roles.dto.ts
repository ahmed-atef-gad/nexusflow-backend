import { ArrayNotEmpty, IsArray, IsEnum } from 'class-validator';
import { Role } from '../enums/role.enum';

export class UpdateRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(Role, { each: true, message: 'Each role must be a valid Role enum value.' })
  roles: Role[];
}
