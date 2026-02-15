import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { RegisterUserDto } from './dto/register-user.dto';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService
  ) {}

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Validates a user by email and password.
   * Called by LocalStrategy (which we'll make).
   */
  async validateUser(email: string, pass: string): Promise<any> {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.usersService.findOneByEmail(normalizedEmail);
    if (user && (await bcrypt.compare(pass, user.password))) {
      const { password, ...result } = user.toObject(); // Don't return hash
      return result;
    }
    return null;
  }

  /**
   * Handles the login request and returns a JWT.
   * Called by the AuthController.
   */
  async login(user: any) {
    await this.usersService.updateLastLogin(user._id);

    const plainMqttPass = crypto.randomBytes(8).toString('hex');
    const salt = await bcrypt.genSalt();
    const hashedMqttPass = await bcrypt.hash(plainMqttPass, salt);
    await this.usersService.updateMqttPasswordHash(user._id, hashedMqttPass);
    const payload = {
      email: user.email,
      sub: user._id,
      roles: user.roles,
      username: user.username,
    };
    return {
      access_token: this.jwtService.sign(payload),
      mqtt_password: plainMqttPass, 
      mqtt_username: user.username
    };
  }

  async getProfile(token: string) {
    try {
      const decoded = this.jwtService.verify(token);
      const user = await this.usersService.getUserById(decoded.sub);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }
      const { password, ...result } = user.toObject(); // Exclude password
      return result;
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  /**
   * Handles the registration request.
   * Called by the AuthController.
   */
  async register(registerDto: RegisterUserDto) {
    const normalizedEmail = this.normalizeEmail(registerDto.email);
    // Hash the password
    const saltOrRounds = 10;
    const hashedPassword = await bcrypt.hash(
      registerDto.password,
      saltOrRounds
    );

    const userCreationData = {
      ...registerDto,
      email: normalizedEmail,
      password: hashedPassword, // Use the hash, not the plain password
    };

    // Save the user (UsersService will handle this)
    try {
      const createdUser = await this.usersService.register(userCreationData);
      // Don't return the password hash
      const { password, ...result } = createdUser.toObject();
      return result;
    } catch (error) {
      // Handle errors (e.g., unique email constraint)
      if (error.code === 11000) {
        throw new UnauthorizedException('Email or username already exists');
      }
      throw error;
    }
  }
}
