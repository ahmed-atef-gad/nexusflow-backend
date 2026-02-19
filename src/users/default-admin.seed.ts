import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';
import { Role } from './enums/role.enum';

@Injectable()
export class DefaultAdminSeed implements OnModuleInit {
  private readonly logger = new Logger(DefaultAdminSeed.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService
  ) {}

  async onModuleInit() {
    const email = this.configService
      .get<string>('DEFAULT_ADMIN_EMAIL')
      ?.trim()
      .toLowerCase();

    if (!email) {
      this.logger.warn(
        'Default admin seed skipped: DEFAULT_ADMIN_EMAIL is missing.'
      );
      return;
    }

    const username =
      this.configService.get<string>('DEFAULT_ADMIN_USERNAME')?.trim() ??
      'admin';
    const password = this.configService.get<string>('DEFAULT_ADMIN_PASSWORD');

    if (!password) {
      this.logger.warn(
        'Default admin seed skipped: DEFAULT_ADMIN_PASSWORD is missing.'
      );
      return;
    }

    const existingByEmail = await this.usersService.findOneByEmail(email);
    if (existingByEmail) {
      this.logger.log(`Default admin already exists: ${email}`);
      return;
    }

    const existingByUsername =
      await this.usersService.findOneByUsername(username);
    if (existingByUsername) {
      this.logger.warn(
        `Default admin seed skipped: username "${username}" already exists.`
      );
      return;
    }

    await this.usersService.create({
      email,
      username,
      password,
      roles: [Role.Admin],
      is_active: true,
      email_verified: true,
    });

    this.logger.log(`Default admin created: ${email}`);
  }
}
