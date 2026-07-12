import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import { AuthService, AuthenticatedUser } from '../auth.service';

type GoogleRawProfile = {
  email?: string;
  email_verified?: boolean;
  picture?: string;
  given_name?: string;
  family_name?: string;
};

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private readonly authService: AuthService) {
    const clientID = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const callbackURL = process.env.GOOGLE_CALLBACK;

    if (!clientID || !clientSecret || !callbackURL) {
      throw new Error(
        'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK must be set'
      );
    }

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['openid', 'email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback
  ): Promise<void> {
    try {
      const rawProfile = profile._json as GoogleRawProfile;
      const email = rawProfile.email ?? profile.emails?.[0]?.value;
      const avatarUrl = rawProfile.picture ?? profile.photos?.[0]?.value;
      const user: AuthenticatedUser = await this.authService.validateGoogleUser(
        {
          googleId: profile.id,
          email,
          emailVerified: rawProfile.email_verified === true,
          displayName: profile.displayName,
          firstName: rawProfile.given_name,
          lastName: rawProfile.family_name,
          avatarUrl,
        }
      );

      done(null, user);
    } catch (error) {
      done(error, false);
    }
  }
}
