import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UsersService } from './users.service';
import { User } from './schemas/user.schema';

describe('UsersService', () => {
  let service: UsersService;
  let userModel: {
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
  };

  const execResult = <T>(value: T) => ({
    exec: jest.fn().mockResolvedValue(value),
  });

  const execReject = (error: unknown) => ({
    exec: jest.fn().mockRejectedValue(error),
  });

  beforeEach(async () => {
    userModel = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getModelToken(User.name),
          useValue: userModel,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should reject update when email already exists for another user', async () => {
    const id = new Types.ObjectId().toHexString();
    const existingUser = { _id: new Types.ObjectId() };
    userModel.findOne.mockReturnValue(execResult(existingUser));

    await expect(
      service.update(id, { email: 'Taken@Example.com' })
    ).rejects.toThrow(ConflictException);

    expect(userModel.findOne).toHaveBeenCalledWith({
      _id: { $ne: id },
      email: 'taken@example.com',
      deleted_at: null,
    });
    expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('should reject update when username already exists for another user', async () => {
    const id = new Types.ObjectId().toHexString();
    const existingUser = { _id: new Types.ObjectId() };
    userModel.findOne.mockReturnValue(execResult(existingUser));

    await expect(
      service.update(id, { username: '  existing_user  ' })
    ).rejects.toThrow(ConflictException);

    expect(userModel.findOne).toHaveBeenCalledWith({
      _id: { $ne: id },
      username: 'existing_user',
      deleted_at: null,
    });
    expect(userModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('should normalize email and username before updating', async () => {
    const id = new Types.ObjectId().toHexString();
    const updatedUser = {
      _id: id,
      email: 'new@example.com',
      username: 'new_user',
    };
    userModel.findOne.mockReturnValue(execResult(null));
    userModel.findOneAndUpdate.mockReturnValue(execResult(updatedUser));

    await expect(
      service.update(id, {
        email: ' New@Example.com ',
        username: '  new_user  ',
      })
    ).resolves.toBe(updatedUser);

    expect(userModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id, deleted_at: null },
      {
        email: 'new@example.com',
        username: 'new_user',
      },
      { new: true }
    );
  });

  it('should map duplicate key update errors to a conflict response', async () => {
    const id = new Types.ObjectId().toHexString();
    userModel.findOne.mockReturnValue(execResult(null));
    userModel.findOneAndUpdate.mockReturnValue(execReject({ code: 11000 }));

    await expect(
      service.update(id, { email: 'new@example.com' })
    ).rejects.toThrow(ConflictException);
  });
});
