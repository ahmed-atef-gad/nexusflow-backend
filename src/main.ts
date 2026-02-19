import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: [
      'http://localhost:8080',
      'https://nexusflow-frontend-amber.vercel.app',
    ],
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe());

  app.use(cookieParser());
  // Swagger Setup
  const config = new DocumentBuilder()
    .setTitle('NexusFlow API')
    .setDescription('API documentation for NexusFlow')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // Start Microservices and HTTP server
  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
