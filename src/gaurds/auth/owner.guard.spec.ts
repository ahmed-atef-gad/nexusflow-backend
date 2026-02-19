import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';

jest.mock('../../flows/schemas/flow.schema', () => ({
  Flow: { name: 'Flow' },
}));

const { OwnerGuard } = require('./owner.guard');
const FLOW_MODEL_NAME = 'Flow';

describe('OwnerGuard (flow ownership)', () => {
  const makeFlowModel = (userId: string) => ({
    findById: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ userId }),
      }),
    }),
  });

  const makeContext = (flowId: string, userId: string): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          params: { flowId },
          user: { sub: userId },
        }),
      }),
    }) as unknown as ExecutionContext;

  const makeReflector = (): Reflector =>
    ({
      getAllAndOverride: jest.fn((key: string) => {
        if (key === 'isOwnerCheck') return true;
        if (key === 'ownerParamKey') return 'flowId';
        if (key === 'ownerResourceKey') return 'flow';
        return undefined;
      }),
    }) as unknown as Reflector;

  it('allows access when flow belongs to user', async () => {
    const flowId = new Types.ObjectId().toString();
    const userId = new Types.ObjectId().toString();
    const flowModel = makeFlowModel(userId);
    const connection = {
      model: jest.fn().mockImplementation((name: string) => {
        if (name === FLOW_MODEL_NAME) return flowModel;
        throw new Error(`Unexpected model: ${name}`);
      }),
    };

    const guard = new OwnerGuard(makeReflector(), connection as any);
    await expect(guard.canActivate(makeContext(flowId, userId))).resolves.toBe(
      true
    );
  });

  it('denies access when flow belongs to another user', async () => {
    const flowId = new Types.ObjectId().toString();
    const ownerId = new Types.ObjectId().toString();
    const requesterId = new Types.ObjectId().toString();
    const flowModel = makeFlowModel(ownerId);
    const connection = {
      model: jest.fn().mockImplementation((name: string) => {
        if (name === FLOW_MODEL_NAME) return flowModel;
        throw new Error(`Unexpected model: ${name}`);
      }),
    };

    const guard = new OwnerGuard(makeReflector(), connection as any);
    await expect(
      guard.canActivate(makeContext(flowId, requesterId))
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
