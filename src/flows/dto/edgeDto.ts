import { IsBoolean, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EdgeDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'edge-1' })
  id: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'node-1' })
  source: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'node-2' })
  target: string;

  @IsBoolean()
  @ApiProperty({ example: true })
  animated?: boolean;
}