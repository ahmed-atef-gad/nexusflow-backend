import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersModule } from 'src/users/users.module';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthGuard } from 'src/guards/auth/auth.guard';
import { VerificationModule } from 'src/verification/verification.module';
import {
  NotificationDeviceToken,
  NotificationDeviceTokenSchema,
} from 'src/notifications/schemas/notification-device-token.schema';
import { GoogleStrategy } from './strategies/google.strategy';
import { GoogleOAuthGuard } from 'src/guards/auth/google-oauth.guard';

@Module({
  imports: [
    UsersModule,
    VerificationModule,
    MongooseModule.forFeature([
      {
        name: NotificationDeviceToken.name,
        schema: NotificationDeviceTokenSchema,
      },
    ]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1d' },
      }),
    }),
  ],
  providers: [AuthService, AuthGuard, GoogleStrategy, GoogleOAuthGuard],
  controllers: [AuthController],
  exports: [AuthService, JwtModule, AuthGuard],
})
export class AuthModule {}
