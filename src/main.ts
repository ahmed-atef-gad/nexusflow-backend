import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import {
  SwaggerModule,
  DocumentBuilder,
  SwaggerCustomOptions,
} from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';

type SwaggerUiOptions = NonNullable<SwaggerCustomOptions['swaggerOptions']>;
type InferredSwaggerRequest = Parameters<
  NonNullable<SwaggerUiOptions['requestInterceptor']>
>[0];
type InferredSwaggerResponse = Parameters<
  NonNullable<SwaggerUiOptions['responseInterceptor']>
>[0];

type SwaggerRequest = (InferredSwaggerRequest extends object
  ? InferredSwaggerRequest
  : Record<string, unknown>) & {
  url: string;
  method?: string;
  headers?: Record<string, string>;
};

type SwaggerResponse = (InferredSwaggerResponse extends object
  ? InferredSwaggerResponse
  : Record<string, unknown>) & {
  status?: number;
  url?: string;
  ok: boolean;
  obj: {
    access_token?: string;
  };
};

type ClientWindow = Window & {
  __lastSwaggerRequest?: SwaggerRequest;
  __retryingAfterRefresh?: boolean;
  ui?: {
    preauthorizeApiKey: (schemeName: string, value: string) => void;
  };
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
  // Do NOT keep retry state in server closure; the interceptor functions
  // are serialized into the client page. Keep state on `window` instead.

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
  // Use Helmet for common security headers: X-Frame-Options, X-Content-Type-Options,
  // X-XSS-Protection, Referrer-Policy, etc. CSP is disabled here by default to avoid
  // breaking Swagger/UI during development.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      frameguard: { action: 'deny' }, // Set X-Frame-Options: DENY
    } as never)
  );

  // Enforce JSON-only for state-changing requests (POST/PUT/PATCH/DELETE).
  // This prevents form-based CSRF attacks by rejecting non-JSON content types.
  // GET, HEAD, and OPTIONS requests bypass this check as they should not have bodies.
  // File upload endpoints (multipart/form-data) are explicitly exempted.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }

    // Exempt file upload endpoints that require multipart/form-data
    const fileUploadPaths = ['/firmware/admin/upload'];
    if (fileUploadPaths.some((path) => req.path.includes(path))) {
      return next();
    }

    const contentType = req.get('content-type');
    if (!contentType?.includes('application/json')) {
      return res.status(415).json({
        statusCode: 415,
        message: 'Unsupported Media Type',
        error: 'Only application/json Content-Type is accepted for mutations',
      });
    }

    next();
  });

  const config = new DocumentBuilder()
    .setTitle('NexusFlow API')
    .setDescription(
      'API documentation for NexusFlow.\n\nSecurity model:\n- All API requests use JSON payloads and Bearer token (Authorization header).\n- POST/PUT/PATCH/DELETE requests trigger CORS preflight (OPTIONS) which protects against CSRF attacks.\n- Refresh tokens are stored as HttpOnly cookies for secure refresh flow, but API operations use Bearer tokens.'
    )
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
      requestInterceptor: (request: SwaggerRequest) => {
        const clientWindow = window as ClientWindow;
        clientWindow.__lastSwaggerRequest = request;
        return request;
      },
      responseInterceptor: async (response: SwaggerResponse) => {
        let interceptedResponse = response;
        const status = response.status;
        const requestUrl = String(response.url || '');
        const clientWindow = window as ClientWindow;
        const isLogin = requestUrl.endsWith('/auth/login');

        if (
          status === 401 &&
          !requestUrl.includes('/auth/') &&
          !clientWindow.__retryingAfterRefresh
        ) {
          try {
            const csrfToken = window.document.cookie
              .split('; ')
              .find((value) => value.startsWith('XSRF-TOKEN='))
              ?.split('=')[1];
            const refreshResponse = await fetch('/auth/refresh', {
              method: 'POST',
              credentials: 'include',
              headers: {
                'Content-Type': 'application/json',
                ...(csrfToken
                  ? { 'x-csrf-token': decodeURIComponent(csrfToken) }
                  : {}),
              },
            });

            if (refreshResponse.ok) {
              const data = (await refreshResponse.json()) as {
                access_token?: string;
              };

              if (data.access_token && clientWindow.ui?.preauthorizeApiKey) {
                clientWindow.ui.preauthorizeApiKey(
                  'access-token',
                  data.access_token
                );

                const lastReq =
                  clientWindow.__lastSwaggerRequest as SwaggerRequest | null;
                if (lastReq?.url) {
                  try {
                    clientWindow.__retryingAfterRefresh = true;
                    const { url, ...requestInit } = lastReq;
                    const headers = {
                      ...(requestInit.headers as Record<string, string>),
                      Authorization: `Bearer ${data.access_token}`,
                    };
                    const retriedResponse = await fetch(url, {
                      ...(requestInit as object),
                      headers,
                    } as never);
                    const responseText = await retriedResponse.text();

                    let parsedBody: unknown;
                    try {
                      parsedBody = responseText
                        ? JSON.parse(responseText)
                        : undefined;
                    } catch {
                      parsedBody = responseText;
                    }

                    interceptedResponse = {
                      ...response,
                      status: retriedResponse.status,
                      url: retriedResponse.url,
                      ok: retriedResponse.ok,
                      statusText: retriedResponse.statusText,
                      headers: Object.fromEntries(
                        retriedResponse.headers.entries()
                      ),
                      text: responseText,
                      data: parsedBody,
                      body: parsedBody,
                      obj: parsedBody,
                    } as SwaggerResponse;
                  } catch {
                    // ignore retry failures; the original 401 still surfaces.
                  } finally {
                    clientWindow.__retryingAfterRefresh = false;
                  }
                }
              }
            }
          } catch {
            // Ignore refresh failures here; the original 401 still surfaces.
          }
        } else if (isLogin && response.ok) {
          if (response.obj?.access_token) {
            clientWindow.ui?.preauthorizeApiKey?.(
              'access-token',
              response.obj.access_token
            );
          }
        }

        return interceptedResponse;
      },
    },
  });

  await app.startAllMicroservices();
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
