import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';

type SwaggerResponse = {
  status?: number;
  url?: string;
};

function getAllowedCorsOrigins(): string[] {
  const corsOrigins = process.env.CORS_ORIGINS;

  if (!corsOrigins) {
    throw new Error(
      'CORS_ORIGINS environment variable is not set. Provide a comma-separated list of allowed origins.'
    );
  }

  const origins = corsOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error(
      'CORS_ORIGINS environment variable is empty. Provide at least one allowed origin.'
    );
  }

  const invalidOrigins = origins.filter((origin) => {
    try {
      const parsed = new URL(origin);
      return !['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return true;
    }
  });

  if (invalidOrigins.length > 0) {
    throw new Error(
      `Invalid URL(s) found in CORS_ORIGINS: ${invalidOrigins.join(', ')}`
    );
  }

  return origins;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const allowedOrigins = getAllowedCorsOrigins();

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  );

  app.use(cookieParser());

  const config = new DocumentBuilder()
    .setTitle('NexusFlow API')
    .setDescription('API documentation for NexusFlow')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'access-token'
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      responseInterceptor: async (response: SwaggerResponse) => {
        const status = response.status;
        const requestUrl = String(response.url || '');
        console.log(response);

        if (status === 401 && !requestUrl.includes('/auth/')) {
          try {
            const refreshResponse = await fetch('/auth/refresh', {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
              },
            });

            if (refreshResponse.ok) {
              const data = (await refreshResponse.json()) as {
                access_token?: string;
              };
              const swaggerWindow = window as Window & {
                ui?: {
                  preauthorizeApiKey: (
                    schemeName: string,
                    value: string
                  ) => void;
                };
              };

              if (data.access_token && swaggerWindow.ui?.preauthorizeApiKey) {
                swaggerWindow.ui.preauthorizeApiKey(
                  'access-token',
                  data.access_token
                );
              }
            }
          } catch {
            // Ignore refresh failures here; the original 401 still surfaces.
          }
        }

        return response;
      },
    },
  });

  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
