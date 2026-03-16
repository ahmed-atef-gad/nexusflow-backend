import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ForkFlowTemplateDto {
  @ApiPropertyOptional({
    description: 'Optional custom name for the newly created flow.',
    example: 'My Lighting Flow',
  })
  @IsOptional()
  @IsString()
  name?: string;
}
