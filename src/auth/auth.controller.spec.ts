import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '../security/csrf.constants';
import { REFRESH_TOKEN_COOKIE } from './utils/auth.util';

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

describe('AuthController', () => {
  let controller: AuthController;
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalCorsOrigins = process.env.CORS_ORIGINS;
  const originalGoogleVerificationRedirectPath =
    process.env.GOOGLE_VERIFICATION_REDIRECT_PATH;
  let authService: {
    getGoogleAuthorizationUrl: jest.Mock;
    login: jest.Mock;
    register: jest.Mock;
    validateUser: jest.Mock;
    refresh: jest.Mock;
    forgotPassword: jest.Mock;
    resetPassword: jest.Mock;
    logout: jest.Mock;
  };

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    authService = {
      getGoogleAuthorizationUrl: jest.fn(),
      login: jest.fn(),
      register: jest.fn(),
      validateUser: jest.fn(),
      refresh: jest.fn(),
      forgotPassword: jest.fn(),
      resetPassword: jest.fn(),
      logout: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  afterEach(() => {
    restoreEnv('JWT_SECRET', originalJwtSecret);
    restoreEnv('CORS_ORIGINS', originalCorsOrigins);
    restoreEnv(
      'GOOGLE_VERIFICATION_REDIRECT_PATH',
      originalGoogleVerificationRedirectPath
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('redirects Google signups that still need OTP verification', async () => {
    const redirect = jest.fn();
    const cookie = jest.fn();
    const clearCookie = jest.fn();

    await controller.googleCallback(
      {
        user: {
          _id: 'user-id',
          email: 'user@example.com',
          roles: ['user'],
          username: 'user',
          requires_email_verification: true,
        },
        cookies: {},
      } as never,
      {
        redirect,
        cookie,
        clearCookie,
      } as never
    );

    expect(authService.login).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(
      expect.stringContaining('verification_required=true')
    );
  });

  it('redirects Google signups needing OTP to configured verification path', async () => {
    process.env.GOOGLE_VERIFICATION_REDIRECT_PATH = '/verify-email';
    const redirect = jest.fn();
    const cookie = jest.fn();
    const clearCookie = jest.fn();

    await controller.googleCallback(
      {
        user: {
          _id: 'user-id',
          email: 'user@example.com',
          roles: ['user'],
          username: 'user',
          requires_email_verification: true,
        },
        cookies: {},
      } as never,
      {
        redirect,
        cookie,
        clearCookie,
        locals: {},
      } as never
    );

    const redirectUrl = new URL(redirect.mock.calls[0][0]);
    expect(redirectUrl.origin).toBe('https://app.example.com');
    expect(redirectUrl.pathname).toBe('/verify-email');
    expect(redirectUrl.searchParams.get('verification_required')).toBe('true');
    expect(redirectUrl.searchParams.get('reason')).toBe(
      'email_verification_required'
    );
    expect(redirectUrl.searchParams.get('email')).toBe('user@example.com');
  });

  it('sets refresh cookie and redirects Google logins with access and CSRF tokens', async () => {
    authService.login.mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      mqtt_username: 'user',
      mqtt_password: 'mqtt-password',
    });
    const redirect = jest.fn();
    const cookie = jest.fn();
    const clearCookie = jest.fn();

    await controller.googleCallback(
      {
        user: {
          _id: 'user-id',
          email: 'user@example.com',
          roles: ['user'],
          username: 'user',
        },
        cookies: {},
      } as never,
      {
        redirect,
        cookie,
        clearCookie,
        locals: {},
      } as never
    );

    expect(cookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      'refresh-token',
      expect.objectContaining({
        httpOnly: true,
        path: '/',
      })
    );
    const redirectUrl = new URL(redirect.mock.calls[0][0]);
    expect(redirectUrl.origin).toBe('https://app.example.com');
    expect(redirectUrl.pathname).toBe('/auth/google/callback');
    expect(redirectUrl.searchParams.get('token')).toBe('access-token');
    expect(redirectUrl.searchParams.get('csrf_token')).toEqual(
      expect.any(String)
    );
    expect(redirectUrl.searchParams.get('csrf_header')).toBe(CSRF_HEADER_NAME);
  });

  it('sets rotated refresh cookie and returns access and CSRF tokens during refresh', async () => {
    authService.refresh.mockResolvedValue({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
    });
    const cookie = jest.fn();

    const result = await controller.refresh(
      {
        cookies: {
          [REFRESH_TOKEN_COOKIE]: 'old-refresh-token',
        },
      } as never,
      {
        cookie,
        locals: {},
      } as never
    );

    expect(authService.refresh).toHaveBeenCalledWith('old-refresh-token');
    expect(cookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      'new-refresh-token',
      expect.objectContaining({
        httpOnly: true,
        path: '/',
      })
    );
    expect(cookie).toHaveBeenCalledWith(
      CSRF_COOKIE_NAME,
      expect.any(String),
      expect.objectContaining({
        path: '/',
      })
    );
    expect(result).toEqual({
      access_token: 'new-access-token',
      csrf_token: expect.any(String),
      csrf_header: CSRF_HEADER_NAME,
    });
  });

  it('does not set refresh cookie when a grace refresh returns only access token', async () => {
    authService.refresh.mockResolvedValue({
      access_token: 'new-access-token',
    });
    const cookie = jest.fn();

    await controller.refresh(
      {
        cookies: {
          [REFRESH_TOKEN_COOKIE]: 'previous-refresh-token',
        },
      } as never,
      {
        cookie,
        locals: {},
      } as never
    );

    expect(cookie).not.toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      expect.any(String),
      expect.any(Object)
    );
  });
});
