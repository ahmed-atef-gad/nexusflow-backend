import { Controller, Logger } from '@nestjs/common';
import { MessagePattern, Payload, Ctx, MqttContext } from '@nestjs/microservices';

@Controller()
export class MqttController {
  private readonly logger = new Logger(MqttController.name);

  @MessagePattern('esp/+/data') // Example pattern
  handleData(@Payload() data: any, @Ctx() context: MqttContext) {
    const topic = context.getTopic();
    this.logger.log(`Received on ${topic}: ${JSON.stringify(data)}`);
  }
}