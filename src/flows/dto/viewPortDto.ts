import { IsObject } from 'class-validator';

export class ViewportDto {
  @IsObject()
  x: number;
  y: number;
  zoom: number;
}
