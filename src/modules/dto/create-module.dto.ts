import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsObject } from 'class-validator';

export class CreateModuleDto {
  @ApiProperty({ example: 'ESP32 GPIO' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'chip', required: false })
  @IsOptional()
  @IsString()
  icon?: string;

  @ApiProperty({ example: 'from-green-400 to-blue-500', required: false })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiProperty({ example: 'Hardware' })
  @IsString()
  category!: string;

  @ApiProperty({
    enum: ['source', 'target', 'both'],
    default: 'both',
    required: false,
  })
  @IsOptional()
  @IsEnum(['source', 'target', 'both'])
  ports?: 'source' | 'target' | 'both';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  alias?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ required: false, example: { voltage: '3.3V' } })
  @IsOptional()
  @IsObject()
  options?: Record<string, any>;

  @ApiProperty({ required: false, example: { pin: '12', state: 'high' } })
  @IsOptional()
  @IsObject()
  variables?: Record<string, string>;
}
