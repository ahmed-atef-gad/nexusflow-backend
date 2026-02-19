import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { JwtService } from '@nestjs/jwt';
import { RolesGuard } from '../gaurds/auth/roles.guard';
import { OwnerGuard } from '../gaurds/auth/owner.guard';
import { DefaultAdminSeed } from './default-admin.seed';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [UsersController],
  providers: [UsersService, JwtService, RolesGuard, OwnerGuard, DefaultAdminSeed],
  exports: [UsersService],
})
export class UsersModule {}
