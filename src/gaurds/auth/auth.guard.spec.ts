import { AuthGuard } from './auth.guard';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from 'src/users/users.service';

describe('AuthGuard', () => {
  it('should be defined', () => {
    expect(
      new AuthGuard(
        {} as JwtService,
        {} as ConfigService,
        {} as UsersService
      )
    ).toBeDefined();
  });
});
