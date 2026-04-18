import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AlertEvent, AlertEventSchema } from './schemas/alert-event.schema';
import { AlertPolicy, AlertPolicySchema } from './schemas/alert-policy.schema';
import { AlertRule, AlertRuleSchema } from './schemas/alert-rule.schema';
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
    MongooseModule.forFeature([
      { name: NotificationDeviceToken.name, schema: NotificationDeviceTokenSchema },
      { name: AlertEvent.name, schema: AlertEventSchema },
      { name: NotificationPreference.name, schema: NotificationPreferenceSchema },
      { name: AlertPolicy.name, schema: AlertPolicySchema },
      { name: AlertRule.name, schema: AlertRuleSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class NotificationsModule {}
