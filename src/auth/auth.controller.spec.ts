import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleAuthHandoffService } from './services/google-auth-handoff.service';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '../security/csrf.constants';
import { REFRESH_TOKEN_COOKIE } from './utils/auth.util';
import { createGoogleOAuthState } from './utils/oauth-state.util';

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
  const originalGoogleMobileRedirectUri =
    process.env.GOOGLE_MOBILE_REDIRECT_URI;
  let authService: {
    getGoogleAuthorizationUrl: jest.Mock;
    getAuthenticatedUserById: jest.Mock;
    login: jest.Mock;
    register: jest.Mock;
    validateUser: jest.Mock;
    refresh: jest.Mock;
    forgotPassword: jest.Mock;
    resetPassword: jest.Mock;
    logout: jest.Mock;
  };
  let googleAuthHandoffService: {
    create: jest.Mock;
    consume: jest.Mock;
  };

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.CORS_ORIGINS = 'https://app.example.com';
    process.env.GOOGLE_MOBILE_REDIRECT_URI =
      'https://mobile.example.com/auth/google/mobile-callback';
    authService = {
      getGoogleAuthorizationUrl: jest.fn(),
      getAuthenticatedUserById: jest.fn(),
      login: jest.fn(),
      register: jest.fn(),
      validateUser: jest.fn(),
      refresh: jest.fn(),
      forgotPassword: jest.fn(),
      resetPassword: jest.fn(),
      logout: jest.fn(),
    };
    googleAuthHandoffService = {
      create: jest.fn(),
      consume: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: GoogleAuthHandoffService,
          useValue: googleAuthHandoffService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  afterEach(() => {
    restoreEnv('JWT_SECRET', originalJwtSecret);
    restoreEnv('CORS_ORIGINS', originalCorsOrigins);
    restoreEnv('GOOGLE_MOBILE_REDIRECT_URI', originalGoogleMobileRedirectUri);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('sets session tokens for Google signups that still need OTP verification', async () => {
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

    expect(authService.login).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'user@example.com',
        requires_email_verification: true,
      })
    );
    expect(clearCookie).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object)
    );
    expect(cookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      'refresh-token',
      expect.objectContaining({
        httpOnly: true,
        path: '/',
      })
    );
    const redirectCall = redirect.mock.calls[0] as [string];
    const redirectUrl = new URL(redirectCall[0]);
    expect(redirectUrl.pathname).toBe('/auth/google/callback');
    expect(redirectUrl.searchParams.get('token')).toBe('access-token');
    expect(redirectUrl.searchParams.get('csrf_token')).toEqual(
      expect.any(String)
    );
    expect(redirectUrl.searchParams.get('csrf_header')).toBe(CSRF_HEADER_NAME);
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
    const redirectCall = redirect.mock.calls[0] as [string];
    const redirectUrl = new URL(redirectCall[0]);
    expect(redirectUrl.origin).toBe('https://app.example.com');
    expect(redirectUrl.pathname).toBe('/auth/google/callback');
    expect(redirectUrl.searchParams.get('token')).toBe('access-token');
    expect(redirectUrl.searchParams.get('csrf_token')).toEqual(
      expect.any(String)
    );
    expect(redirectUrl.searchParams.get('csrf_header')).toBe(CSRF_HEADER_NAME);
  });

  it('redirects mobile Google callbacks with a short-lived handoff code', async () => {
    const state = createGoogleOAuthState({
      client: 'mobile',
      codeChallenge: 'a'.repeat(43),
    });
    googleAuthHandoffService.create.mockResolvedValue('handoff-code');
    const redirect = jest.fn();
    const clearCookie = jest.fn();

    await controller.googleCallback(
      {
        query: { state },
        user: {
          _id: '507f1f77bcf86cd799439011',
          email: 'user@example.com',
          roles: ['user'],
          username: 'user',
        },
        cookies: {},
      } as never,
      {
        redirect,
        clearCookie,
      } as never
    );

    expect(authService.login).not.toHaveBeenCalled();
    expect(googleAuthHandoffService.create).toHaveBeenCalledWith({
      userId: '507f1f77bcf86cd799439011',
      codeChallenge: 'a'.repeat(43),
    });
    expect(clearCookie).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object)
    );
    const redirectCall = redirect.mock.calls[0] as [string];
    const redirectUrl = new URL(redirectCall[0]);
    expect(redirectUrl.origin).toBe('https://mobile.example.com');
    expect(redirectUrl.pathname).toBe('/auth/google/mobile-callback');
    expect(redirectUrl.searchParams.get('code')).toBe('handoff-code');
    expect(redirectUrl.searchParams.has('token')).toBe(false);
  });

  it('exchanges mobile Google handoff codes for normal session credentials', async () => {
    googleAuthHandoffService.consume.mockResolvedValue({ userId: 'user-id' });
    authService.getAuthenticatedUserById.mockResolvedValue({
      _id: 'user-id',
      email: 'user@example.com',
      roles: ['user'],
      username: 'user',
      requires_email_verification: true,
    });
    authService.login.mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      mqtt_username: 'user',
      mqtt_password: 'mqtt-password',
    });
    const cookie = jest.fn();

    const result = await controller.exchangeGoogleMobileCode(
      {
        cookies: {},
      } as never,
      {
        cookie,
        locals: {},
      } as never,
      {
        code: 'handoff-code',
        code_verifier: 'v'.repeat(43),
      }
    );

    expect(googleAuthHandoffService.consume).toHaveBeenCalledWith({
      code: 'handoff-code',
      codeVerifier: 'v'.repeat(43),
    });
    expect(authService.getAuthenticatedUserById).toHaveBeenCalledWith(
      'user-id'
    );
    expect(cookie).toHaveBeenCalledWith(
      REFRESH_TOKEN_COOKIE,
      'refresh-token',
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
    expect(typeof result.csrf_token).toBe('string');
    expect(result).toEqual({
      access_token: 'access-token',
      csrf_token: result.csrf_token,
      csrf_header: CSRF_HEADER_NAME,
      mqtt: {
        username: 'user',
        password: 'mqtt-password',
        clientId: 'user',
      },
      requires_email_verification: true,
    });
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
    expect(result.access_token).toBe('new-access-token');
    expect(typeof result.csrf_token).toBe('string');
    expect(result.csrf_header).toBe(CSRF_HEADER_NAME);
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
