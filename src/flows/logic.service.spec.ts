import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { LogicService } from './logic.service';
import { CommandExtraction } from './flow-builder.service';
import { LogicDocument } from './schemas/logic.schema';

describe('LogicService', () => {
  let service: LogicService;

  beforeEach(() => {
    service = new LogicService(
      {} as unknown as Model<LogicDocument>,
      { get: jest.fn() } as unknown as ConfigService
    );
  });

  const getSanitizer = () =>
    service as unknown as {
      sanitizeProgram(program: CommandExtraction): CommandExtraction;
    };

  it('accepts mqtt-out as a terminal runtime step', () => {
    const program: CommandExtraction = {
      flows: [
        [
          { id: 'input-1', moduleId: 'mqtt-in', stepType: 'input' },
          {
            id: 'mqtt-out-1',
            moduleId: 'mqtt-out',
            stepType: 'mqtt-out',
            channel: 'default',
            targetFlowIds: ['flow-a'],
          },
        ],
      ],
      warnings: [],
    };

    expect(getSanitizer().sanitizeProgram(program)).toEqual(program);
  });

  it('rejects a non-output terminal step', () => {
    const program: CommandExtraction = {
      flows: [[{ id: 'input-1', moduleId: 'mqtt-in', stepType: 'input' }]],
      warnings: [],
    };

    expect(() => getSanitizer().sanitizeProgram(program)).toThrow(
      BadRequestException
    );
  });
});
