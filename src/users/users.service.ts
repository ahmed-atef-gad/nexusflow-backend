import { HttpException, Injectable, Param } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { RegisterUserDto } from 'src/auth/dto/register-user.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { Role } from './enums/role.enum';


@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  // Change 'undefined' to 'null'
  async findOneByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email }).exec();
  }
  async register(registerUserDto: RegisterUserDto): Promise<UserDocument> {
    const createdUser = new this.userModel(registerUserDto);
    createdUser.roles = [Role.User]; // Default role
    return createdUser.save();
  }
  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
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
  async delete(@Param('id') id: string): Promise<{ deleted: boolean }> {
    const isValidId = Types.ObjectId.isValid(id);
    if (!isValidId) {
      throw new HttpException('User not found', 404);
    }
    const result = await this.userModel.deleteOne({ _id: id }).exec();
    return { deleted: result.deletedCount === 1 };
  }

  async updateLastLogin(@Param('id') userId: string) {
    return this.userModel.updateOne(
      { _id: userId },
      { $set: { last_login: new Date() } }
    ).exec();
  }
}