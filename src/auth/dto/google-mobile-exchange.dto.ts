import { IsString, Matches } from 'class-validator';

export class GoogleMobileExchangeDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43,256}$/, {
    message: 'code must be a valid handoff code',
  })
  code!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9._~-]{43,128}$/, {
    message: 'code_verifier must be a valid PKCE verifier',
  })
  code_verifier!: string;
}
