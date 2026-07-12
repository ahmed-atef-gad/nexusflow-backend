import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
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
});
