import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateFlowDto } from 'src/flows/dto/create-flow.dto';

export class CreateFlowTemplateDto extends CreateFlowDto {
  @ApiProperty({ example: 'Smart Home Lighting Starter' })
  @IsString()
  @MaxLength(120)
  declare name: string;

  @ApiPropertyOptional({
    example: 'Template flow for motion-triggered home lighting.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['smart-home', 'lighting'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];
}
