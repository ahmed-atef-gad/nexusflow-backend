import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from 'src/auth/auth.module';
import { UsersModule } from 'src/users/users.module';
import { Device, DeviceSchema } from 'src/devices/schemas/device.schema';
import { AlertPolicy, AlertPolicySchema } from './schemas/alert-policy.schema';
import { AlertRule, AlertRuleSchema } from './schemas/alert-rule.schema';
import { Flow, FlowSchema } from 'src/flows/schemas/flow.schema';
import { Incident, IncidentSchema } from './schemas/incident.schema';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';
import { NotificationsActionsController } from './notifications-actions.controller';
import { NotificationsInternalController } from './notifications-internal.controller';
import { NotificationsController } from './notifications.controller';
import { NotificationsReceiptsController } from './notifications-receipts.controller';
import { ProjectAlertConfigController } from './project-alert-config.controller';
import { ProjectAlertHistoryController } from './project-alert-history.controller';
import { NotificationsService } from './notifications.service';
import { RolesGuard } from 'src/guards/auth/roles.guard';
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
      {
        name: NotificationDeviceToken.name,
        schema: NotificationDeviceTokenSchema,
      },
      { name: Notification.name, schema: NotificationSchema },
      { name: Incident.name, schema: IncidentSchema },
      { name: Device.name, schema: DeviceSchema },
      {
        name: NotificationPreference.name,
        schema: NotificationPreferenceSchema,
      },
      { name: AlertPolicy.name, schema: AlertPolicySchema },
      { name: AlertRule.name, schema: AlertRuleSchema },
      { name: Flow.name, schema: FlowSchema },
    ]),
  ],
  controllers: [
    NotificationsController,
    NotificationsActionsController,
    NotificationsReceiptsController,
    NotificationsInternalController,
    ProjectAlertConfigController,
    ProjectAlertHistoryController,
  ],
  providers: [NotificationsService, RolesGuard],
  exports: [MongooseModule, NotificationsService],
})
export class NotificationsModule {}
