import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from 'src/users/users.service';
import { JwtService } from '@nestjs/jwt';
import { VerificationService } from 'src/verification/verification.service';
import { getModelToken } from '@nestjs/mongoose';
import { NotificationDeviceToken } from 'src/notifications/schemas/notification-device-token.schema';
import * as bcrypt from 'bcrypt';

const toDocument = (user: Record<string, unknown>) => ({
  ...user,
  toObject: () => ({ ...user }),
});

describe('AuthService', () => {
  let service: AuthService;
  const originalJwtSecret = process.env.JWT_SECRET;
  let usersService: {
    findOneByEmail: jest.Mock;
    findOneByGoogleId: jest.Mock;
    findOneByEmailWithGoogleId: jest.Mock;
    linkGoogleAccount: jest.Mock;
    createAvailableUsername: jest.Mock;
    createGoogleUser: jest.Mock;
    getAuthStateById: jest.Mock;
    getRefreshTokenHashById: jest.Mock;
    getRefreshTokenStateById: jest.Mock;
    updateRefreshTokenHash: jest.Mock;
    setRefreshTokenState: jest.Mock;
    rotateRefreshTokenState: jest.Mock;
  };
  let jwtService: {
    sign: jest.Mock;
    verifyAsync: jest.Mock;
  };
  let verificationService: {
    generateOtpForEmail: jest.Mock;
  };

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    usersService = {
      findOneByEmail: jest.fn(),
      findOneByGoogleId: jest.fn(),
      findOneByEmailWithGoogleId: jest.fn(),
      linkGoogleAccount: jest.fn(),
      createAvailableUsername: jest.fn(),
      createGoogleUser: jest.fn(),
      getAuthStateById: jest.fn(),
      getRefreshTokenHashById: jest.fn(),
      getRefreshTokenStateById: jest.fn(),
      updateRefreshTokenHash: jest.fn(),
      setRefreshTokenState: jest.fn(),
      rotateRefreshTokenState: jest.fn(),
    };
    jwtService = {
      sign: jest.fn(),
      verifyAsync: jest.fn(),
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
          useValue: jwtService,
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

  afterEach(() => {
    if (originalJwtSecret === undefined) {
      delete process.env.JWT_SECRET;
      return;
    }

    process.env.JWT_SECRET = originalJwtSecret;
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

  it('sends an OTP and returns a pending verification state for a new Google signup', async () => {
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

    const result = await service.validateGoogleUser({
      googleId: 'google-123',
      email: 'user@example.com',
      emailVerified: true,
    });

    expect(verificationService.generateOtpForEmail).toHaveBeenCalledWith({
      email: 'user@example.com',
    });
    expect(result.requires_email_verification).toBe(true);
    expect(result.email).toBe('user@example.com');
    expect(usersService.createGoogleUser).toHaveBeenCalledWith(
      expect.objectContaining({
        googleId: 'google-123',
        email: 'user@example.com',
      })
    );
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

  it('returns a pending verification state for an unverified linked account', async () => {
    usersService.findOneByGoogleId.mockResolvedValue(null);
    usersService.findOneByEmailWithGoogleId.mockResolvedValue(
      toDocument({
        _id: 'user-id',
        email: 'user@example.com',
        username: 'user',
        roles: ['user'],
        google_id: undefined,
        email_verified: false,
        is_active: true,
      })
    );
    usersService.linkGoogleAccount.mockResolvedValue(
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

    const result = await service.validateGoogleUser({
      googleId: 'google-123',
      email: 'user@example.com',
      emailVerified: true,
    });

    expect(verificationService.generateOtpForEmail).toHaveBeenCalledWith({
      email: 'user@example.com',
    });
    expect(usersService.linkGoogleAccount).toHaveBeenCalledWith(
      'user-id',
      'google-123',
      undefined
    );
    expect(result.requires_email_verification).toBe(true);
  });

  it('returns a pending verification state for an unverified linked Google account', async () => {
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

    const result = await service.validateGoogleUser({
      googleId: 'google-123',
      email: 'user@example.com',
      emailVerified: true,
    });

    expect(result.requires_email_verification).toBe(true);
    expect(verificationService.generateOtpForEmail).toHaveBeenCalledWith({
      email: 'user@example.com',
    });
  });

  it('blocks password login for unverified accounts and sends an OTP', async () => {
    usersService.findOneByEmail.mockResolvedValue(
      toDocument({
        _id: 'user-id',
        email: 'user@example.com',
        username: 'user',
        roles: ['user'],
        password: bcrypt.hashSync('password', 10),
        email_verified: false,
        is_active: true,
      })
    );

    await expect(
      service.validateUser('user@example.com', 'password')
    ).rejects.toThrow('Email must be verified first');
    expect(verificationService.generateOtpForEmail).toHaveBeenCalledWith({
      email: 'user@example.com',
    });
  });

  it('rotates refresh token state when the current refresh token is used', async () => {
    const refreshToken = 'refresh-token';
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-id',
      email: 'user@example.com',
      username: 'user',
      roles: ['user'],
      token_version: 0,
      jti: 'old-jti',
    });
    jwtService.sign
      .mockReturnValueOnce('new-access-token')
      .mockReturnValueOnce('new-refresh-token');
    usersService.getAuthStateById.mockResolvedValue({
      email: 'user@example.com',
      username: 'user',
      tokenVersion: 0,
      emailVerified: true,
      isActive: true,
      roles: ['user'],
    });
    usersService.getRefreshTokenStateById.mockResolvedValue({
      refreshTokenHash: await bcrypt.hash(refreshToken, 10),
      refreshTokenJti: 'old-jti',
      previousRefreshTokenHash: null,
      previousRefreshTokenJti: null,
      previousRefreshTokenExpiresAt: null,
    });
    usersService.rotateRefreshTokenState.mockResolvedValue(true);

    const result = await service.refresh(refreshToken);

    expect(result).toEqual({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
    });
    const rotateCall = usersService.rotateRefreshTokenState.mock.calls[0] as [
      string,
      {
        expectedRefreshTokenJti: string;
        refreshTokenHash: string;
        refreshTokenJti: string;
        previousRefreshTokenHash: string;
        previousRefreshTokenJti: string;
        previousRefreshTokenExpiresAt: Date;
      },
    ];
    expect(rotateCall[0]).toBe('user-id');
    expect(rotateCall[1].expectedRefreshTokenJti).toBe('old-jti');
    expect(typeof rotateCall[1].refreshTokenHash).toBe('string');
    expect(typeof rotateCall[1].refreshTokenJti).toBe('string');
    expect(typeof rotateCall[1].previousRefreshTokenHash).toBe('string');
    expect(rotateCall[1].previousRefreshTokenJti).toBe('old-jti');
    expect(rotateCall[1].previousRefreshTokenExpiresAt).toBeInstanceOf(Date);
    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'user-id',
        email: 'user@example.com',
        username: 'user',
        token_version: 0,
      }),
      expect.objectContaining({
        secret: 'test-jwt-secret',
      })
    );
  });

  it('accepts the previous refresh token during the grace window without rotating again', async () => {
    const refreshToken = 'previous-refresh-token';
    jwtService.verifyAsync.mockResolvedValue({
      sub: 'user-id',
      email: 'user@example.com',
      username: 'user',
      roles: ['user'],
      token_version: 0,
      jti: 'previous-jti',
    });
    jwtService.sign.mockReturnValue('new-access-token');
    usersService.getAuthStateById.mockResolvedValue({
      email: 'user@example.com',
      username: 'user',
      tokenVersion: 0,
      emailVerified: true,
      isActive: true,
      roles: ['user'],
    });
    usersService.getRefreshTokenStateById.mockResolvedValue({
      refreshTokenHash: await bcrypt.hash('current-refresh-token', 10),
      refreshTokenJti: 'current-jti',
      previousRefreshTokenHash: await bcrypt.hash(refreshToken, 10),
      previousRefreshTokenJti: 'previous-jti',
      previousRefreshTokenExpiresAt: new Date(Date.now() + 10_000),
    });

    const result = await service.refresh(refreshToken);

    expect(result).toEqual({ access_token: 'new-access-token' });
    expect(usersService.rotateRefreshTokenState).not.toHaveBeenCalled();
  });
});
