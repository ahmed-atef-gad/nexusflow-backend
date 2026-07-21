import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReadingsService } from './readings.service';
import { ReadingsController } from './readings.controller';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

/**
 * ReadingsModule
 *
 * Owns the time-series sensor readings collection.
 * The collection is created imperatively by ReadingsService.onModuleInit()
 * because Mongoose's @Schema decorator cannot set time-series options.
 *
 * ReadingsService is exported so MqttModule can inject it for fire-and-forget saves.
 */
@Module({
  imports: [
    // MongooseModule.forFeature is not used because the collection is a
    // time-series collection created imperatively; we inject Connection instead.
    MongooseModule,
    AuthModule,
    UsersModule,
  ],
  controllers: [ReadingsController],
  providers: [ReadingsService],
  exports: [ReadingsService],
})
export class ReadingsModule {}
