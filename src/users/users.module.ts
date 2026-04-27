import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { JwtService } from '@nestjs/jwt';
import { RolesGuard } from '../guards/auth/roles.guard';
import { OwnerGuard } from '../guards/auth/owner.guard';
import { DefaultOwnerSeed } from './default-owner.seed';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [UsersController],
  providers: [UsersService, JwtService, RolesGuard, OwnerGuard, DefaultOwnerSeed],
  exports: [UsersService],
})
export class UsersModule {}
