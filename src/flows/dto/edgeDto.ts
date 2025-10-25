import { IsBoolean, IsNotEmpty, IsString } from 'class-validator';

export class EdgeDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  source: string;

  @IsString()
  @IsNotEmpty()
  target: string;

  @IsBoolean()
  animated?: boolean;
}