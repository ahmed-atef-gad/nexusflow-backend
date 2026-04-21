import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from 'src/auth/auth.module';
import { UsersModule } from 'src/users/users.module';
import { AlertEvent, AlertEventSchema } from './schemas/alert-event.schema';
import { AlertPolicy, AlertPolicySchema } from './schemas/alert-policy.schema';
import { AlertRule, AlertRuleSchema } from './schemas/alert-rule.schema';
import { NotificationsInternalController } from './notifications-internal.controller';
import { NotificationsController } from './notifications.controller';
import { ProjectAlertHistoryController } from './project-alert-history.controller';
import { NotificationsService } from './notifications.service';
import {
  NotificationDeviceToken,
  NotificationDeviceTokenSchema,
} from './schemas/notification-device-token.schema';
import {
  NotificationPreference,
  NotificationPreferenceSchema,
} from './schemas/notification-preference.schema';

@Module({
  imports: [
    AuthModule,
    UsersModule,
    MongooseModule.forFeature([
      { name: NotificationDeviceToken.name, schema: NotificationDeviceTokenSchema },
      { name: AlertEvent.name, schema: AlertEventSchema },
      { name: NotificationPreference.name, schema: NotificationPreferenceSchema },
      { name: AlertPolicy.name, schema: AlertPolicySchema },
      { name: AlertRule.name, schema: AlertRuleSchema },
    ]),
  ],
  controllers: [
    NotificationsController,
    NotificationsInternalController,
    ProjectAlertHistoryController,
  ],
  providers: [NotificationsService],
  exports: [MongooseModule, NotificationsService],
})
export class NotificationsModule {}
