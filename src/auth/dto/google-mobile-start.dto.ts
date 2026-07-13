import { Equals, IsString, Matches } from 'class-validator';

export class GoogleMobileStartDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, {
    message: 'code_challenge must be a base64url SHA-256 challenge',
  })
  code_challenge!: string;

  @Equals('S256')
  code_challenge_method!: 'S256';
}
