import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from 'src/users/users.service';
import { JwtService } from '@nestjs/jwt';
import { VerificationService } from 'src/verification/verification.service';
import { getModelToken } from '@nestjs/mongoose';
import { NotificationDeviceToken } from 'src/notifications/schemas/notification-device-token.schema';

const toDocument = (user: Record<string, unknown>) => ({
  ...user,
  toObject: () => ({ ...user }),
});

describe('AuthService', () => {
  let service: AuthService;
  let usersService: {
    findOneByGoogleId: jest.Mock;
    findOneByEmailWithGoogleId: jest.Mock;
    linkGoogleAccount: jest.Mock;
    createAvailableUsername: jest.Mock;
    createGoogleUser: jest.Mock;
  };
  let verificationService: {
    generateOtpForEmail: jest.Mock;
  };

  beforeEach(async () => {
    usersService = {
      findOneByGoogleId: jest.fn(),
      findOneByEmailWithGoogleId: jest.fn(),
      linkGoogleAccount: jest.fn(),
      createAvailableUsername: jest.fn(),
      createGoogleUser: jest.fn(),
    };
    verificationService = {
      generateOtpForEmail: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: usersService,
        },
        {
          provide: JwtService,
          useValue: {},
        },
        {
          provide: VerificationService,
          useValue: verificationService,
        },
        {
          provide: getModelToken(NotificationDeviceToken.name),
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('rejects Google profiles without a verified email', async () => {
    await expect(
      service.validateGoogleUser({
        googleId: 'google-123',
        email: 'user@example.com',
        emailVerified: false,
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('links an existing account only after Google verifies the same email', async () => {
    const existingUser = toDocument({
      _id: 'user-id',
      email: 'user@example.com',
      username: 'user',
      roles: ['user'],
      google_id: undefined,
      is_active: true,
    });
    const linkedUser = toDocument({
      _id: 'user-id',
      email: 'user@example.com',
      username: 'user',
      roles: ['user'],
      google_id: 'google-123',
      is_active: true,
    });
    usersService.findOneByGoogleId.mockResolvedValue(null);
    usersService.findOneByEmailWithGoogleId.mockResolvedValue(existingUser);
    usersService.linkGoogleAccount.mockResolvedValue(linkedUser);

    const result = await service.validateGoogleUser({
      googleId: 'google-123',
      email: 'User@Example.com',
      emailVerified: true,
    });

    expect(usersService.linkGoogleAccount).toHaveBeenCalledWith(
      'user-id',
      'google-123',
      undefined
    );
    expect(result.email).toBe('user@example.com');
    expect(result).not.toHaveProperty('google_id');
  });

  it('rejects an email already linked to a different Google account', async () => {
    usersService.findOneByGoogleId.mockResolvedValue(null);
    usersService.findOneByEmailWithGoogleId.mockResolvedValue(
      toDocument({
        _id: 'user-id',
        email: 'user@example.com',
        username: 'user',
        roles: ['user'],
        google_id: 'other-google-id',
        is_active: true,
      })
    );

    await expect(
      service.validateGoogleUser({
        googleId: 'google-123',
        email: 'user@example.com',
        emailVerified: true,
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(usersService.linkGoogleAccount).not.toHaveBeenCalled();
  });

  it('sends an OTP and blocks new Google registrations until verification', async () => {
    usersService.findOneByGoogleId.mockResolvedValue(null);
    usersService.findOneByEmailWithGoogleId.mockResolvedValue(null);
    usersService.createAvailableUsername.mockResolvedValue('user');
    usersService.createGoogleUser.mockResolvedValue(
      toDocument({
        _id: 'user-id',
        email: 'user@example.com',
        username: 'user',
        roles: ['user'],
        google_id: 'google-123',
        email_verified: false,
        is_active: true,
      })
    );

    await expect(
      service.validateGoogleUser({
        googleId: 'google-123',
        email: 'user@example.com',
        emailVerified: true,
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(verificationService.generateOtpForEmail).toHaveBeenCalledWith({
      email: 'user@example.com',
    });
    expect(usersService.createGoogleUser).toHaveBeenCalledWith(
      expect.objectContaining({
        googleId: 'google-123',
        email: 'user@example.com',
        username: 'user',
      })
    );
  });

  it('blocks Google sign-in for unverified linked accounts', async () => {
    usersService.findOneByGoogleId.mockResolvedValue(
      toDocument({
        _id: 'user-id',
        email: 'user@example.com',
        username: 'user',
        roles: ['user'],
        google_id: 'google-123',
        email_verified: false,
        is_active: true,
      })
    );

    await expect(
      service.validateGoogleUser({
        googleId: 'google-123',
        email: 'user@example.com',
        emailVerified: true,
      })
    ).rejects.toThrow('Email must be verified first');
    expect(verificationService.generateOtpForEmail).not.toHaveBeenCalled();
  });
});
