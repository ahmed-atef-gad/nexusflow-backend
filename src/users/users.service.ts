import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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

  async updateLastLogin(userId: string) {
    return this.userModel.updateOne(
      { _id: userId },
      { $set: { last_login: new Date() } }
    ).exec();
  }
}