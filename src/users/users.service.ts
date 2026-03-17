import { HttpException, Injectable, Param } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { RegisterUserDto } from 'src/auth/dto/register-user.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Role } from './enums/role.enum';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  private toStrictBoolean(value: unknown, defaultValue = false): boolean {
    if (value === true || value === false) return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') return true;
      if (normalized === 'false' || normalized === '0') return false;
    }
    return defaultValue;
  }

  // Change 'undefined' to 'null'
  async findOneByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email }).exec();
  }

  async findOneByUsername(username: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ username: username }).exec();
  }

  async authenticateMqttUser(
    username: string,
    mqttPassword: string
  ): Promise<UserDocument | null> {
    const normalizedUsername = username.trim();
    if (!normalizedUsername || !mqttPassword) return null;

    const user = await this.userModel
      .findOne({ username: normalizedUsername })
      .select('+mqtt_pass_hash +mqtt_pass_used_at')
      .exec();
    if (!user || !user.mqtt_pass_hash) return null;
    if (user.mqtt_pass_used_at) return null;

    const isMatch = await bcrypt.compare(mqttPassword, user.mqtt_pass_hash);
    if (!isMatch) return null;

    const markUsedResult = await this.userModel
      .updateOne(
        {
          _id: user._id,
          mqtt_pass_used_at: null,
          mqtt_pass_hash: user.mqtt_pass_hash,
        },
        { $set: { mqtt_pass_used_at: new Date() } }
      )
      .exec();
    if (!markUsedResult || markUsedResult.modifiedCount !== 1) return null;

    return user;
  }

  async updateMqttPasswordHash(
    @Param('id') userId: string,
    mqttPassHash: string
  ): Promise<UserDocument | null> {
    const isValidId = Types.ObjectId.isValid(userId);
    if (!isValidId) {
      throw new HttpException('User not found', 404);
    }
    return this.userModel
      .findByIdAndUpdate(
        userId,
        { mqtt_pass_hash: mqttPassHash, mqtt_pass_used_at: null },
        { new: true }
      )
      .exec();
  }
  async register(registerUserDto: RegisterUserDto): Promise<UserDocument> {
    const createdUser = new this.userModel(registerUserDto);
    createdUser.roles = [Role.User]; // Default role
    return createdUser.save();
  }
  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
    const saltOrRounds = 10;
    const hashedPassword = await bcrypt.hash(
      createUserDto.password,
      saltOrRounds
    );
    createUserDto.password = hashedPassword;
    const createdUser = new this.userModel(createUserDto);
    return createdUser.save();
  }
  async findAll(): Promise<UserDocument[]> {
    return this.userModel.find().exec();
  }
  async getUserById(@Param('id') id: string): Promise<UserDocument | null> {
    const isValidId = Types.ObjectId.isValid(id);

    if (!isValidId) {
      throw new HttpException('User not found', 404);
    }
    return this.userModel.findById(id).exec();
  }
  async update(
    @Param('id') id: string,
    updateUserDto: UpdateUserDto
  ): Promise<UserDocument | null> {
    const isValidId = Types.ObjectId.isValid(id);
    if (!isValidId) {
      throw new HttpException('User not found', 404);
    }
    if (updateUserDto.password) {
      const saltOrRounds = 10;
      updateUserDto.password = await bcrypt.hash(
        updateUserDto.password,
        saltOrRounds
      );
    }
    return this.userModel
      .findByIdAndUpdate(id, updateUserDto, { new: true })
      .exec();
  }
  async delete(@Param('id') id: string): Promise<{ deleted: boolean }> {
    const isValidId = Types.ObjectId.isValid(id);
    if (!isValidId) {
      throw new HttpException('User not found', 404);
    }
    const result = await this.userModel.deleteOne({ _id: id }).exec();
    return { deleted: result.deletedCount === 1 };
  }

  async updateLastLogin(@Param('id') userId: string) {
    return this.userModel
      .updateOne({ _id: userId }, { $set: { last_login: new Date() } })
      .exec();
  }

  async getTokenVersionById(userId: string): Promise<number | null> {
    const isValidId = Types.ObjectId.isValid(userId);
    if (!isValidId) return null;
    const user = await this.userModel
      .findById(userId)
      .select('token_version')
      .exec();
    if (!user) return null;
    return typeof user.token_version === 'number' ? user.token_version : 0;
  }

  async getAuthStateById(userId: string): Promise<{
    tokenVersion: number;
    emailVerified: boolean;
    isActive: boolean;
  } | null> {
    const isValidId = Types.ObjectId.isValid(userId);
    if (!isValidId) return null;
    const user = await this.userModel
      .findById(userId)
      .select('token_version email_verified is_active')
      .lean()
      .exec();
    if (!user) return null;
    return {
      tokenVersion:
        typeof user.token_version === 'number' ? user.token_version : 0,
      emailVerified: this.toStrictBoolean(user.email_verified, false),
      isActive: this.toStrictBoolean(user.is_active, true),
    };
  }

  async incrementTokenVersion(userId: string): Promise<boolean> {
    const isValidId = Types.ObjectId.isValid(userId);
    if (!isValidId) return false;
    const result = await this.userModel
      .updateOne({ _id: userId }, { $inc: { token_version: 1 } })
      .exec();
    return result.modifiedCount === 1;
  }

  async markEmailAsVerifiedByEmail(email: string): Promise<boolean> {
    const result = await this.userModel
      .updateOne(
        { email: email.trim().toLowerCase() },
        { $set: { email_verified: true } }
      )
      .exec();
    return result.modifiedCount === 1;
  }

  async updatePasswordByEmail(
    email: string,
    passwordHash: string
  ): Promise<boolean> {
    const normalizedEmail = email.trim().toLowerCase();
    const result = await this.userModel
      .updateOne(
        { email: normalizedEmail },
        { $set: { password: passwordHash } }
      )
      .exec();
    return result.matchedCount === 1;
  }

  async incrementTokenVersionByEmail(email: string): Promise<boolean> {
    const normalizedEmail = email.trim().toLowerCase();
    const result = await this.userModel
      .updateOne({ email: normalizedEmail }, { $inc: { token_version: 1 } })
      .exec();
    return result.matchedCount === 1;
  }

  async generateMqttOTP(userId: string): Promise<string> {
    const plainMqttPass = crypto.randomBytes(8).toString('hex');
    const salt = await bcrypt.genSalt();
    const hashedMqttPass = await bcrypt.hash(plainMqttPass, salt);
    await this.updateMqttPasswordHash(userId, hashedMqttPass);
    return plainMqttPass;
  }
}
