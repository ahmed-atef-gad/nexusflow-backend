import { GoogleStrategy } from './google.strategy';

describe('GoogleStrategy', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GOOGLE_CLIENT_ID: 'google-client-id',
      GOOGLE_CLIENT_SECRET: 'google-client-secret',
      GOOGLE_CALLBACK: 'http://localhost:3000/auth/google/callback',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('treats a string email_verified value as verified', async () => {
    const authService = {
      validateGoogleUser: jest.fn().mockResolvedValue({
        _id: 'user-id',
        email: 'user@example.com',
        roles: ['user'],
        username: 'user',
      }),
    };
    const strategy = new GoogleStrategy(authService as never);
    const done = jest.fn();

    await strategy.validate(
      'access-token',
      'refresh-token',
      {
        id: 'google-123',
        displayName: 'User Example',
        _json: {
          email: 'user@example.com',
          email_verified: 'true',
          picture: 'https://example.com/avatar.png',
          given_name: 'User',
          family_name: 'Example',
        },
        emails: [{ value: 'user@example.com' }],
        photos: [{ value: 'https://example.com/avatar.png' }],
      } as never,
      done
    );

    expect(authService.validateGoogleUser).toHaveBeenCalledWith(
      expect.objectContaining({
        googleId: 'google-123',
        email: 'user@example.com',
        emailVerified: true,
      })
    );
    expect(done).toHaveBeenCalledWith(null, {
      _id: 'user-id',
      email: 'user@example.com',
      roles: ['user'],
      username: 'user',
    });
  });
});
