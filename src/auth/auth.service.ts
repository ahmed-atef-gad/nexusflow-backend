import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  /**
   * Validates a user by email and password.
   * Called by LocalStrategy (which we'll make).
   */
  async validateUser(email: string, pass: string): Promise<any> {
    const user = await this.usersService.findOneByEmail(email);
    if (user && (await bcrypt.compare(pass, user.passwordHash))) {
      const { passwordHash, ...result } = user.toObject(); // Don't return hash
      return result;
    }
    return null;
  }

  /**
   * Handles the login request and returns a JWT.
   * Called by the AuthController.
   */
  async login(user: any) {
    const payload = { email: user.email, sub: user._id, roles: user.roles };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  /**
   * Handles the registration request.
   * Called by the AuthController.
   */
  async register(registerDto: any) {
    // Hash the password
    const saltOrRounds = 10;
    const hashedPassword = await bcrypt.hash(registerDto.password, saltOrRounds);

    // Create the new user object
    const newUser = {
      email: registerDto.email,
      username: registerDto.username,
      passwordHash: hashedPassword,
      // ... other fields from your DTO
    };

    // Save the user (UsersService will handle this)
    try {
      const createdUser = await this.usersService.create(newUser);
      // Don't return the password hash
      const { passwordHash, ...result } = createdUser.toObject();
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