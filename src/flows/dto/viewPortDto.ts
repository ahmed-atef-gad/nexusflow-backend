import { IsNumber, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ViewportDto {
  @ApiProperty({ example: 100.51515 })
  @IsNumber()
  x: number;
  @ApiProperty({ example: 200.51515 })
  @IsNumber()
  y: number;
  @ApiProperty({ example: 1.5 })
  @IsNumber()
  zoom: number;
}
