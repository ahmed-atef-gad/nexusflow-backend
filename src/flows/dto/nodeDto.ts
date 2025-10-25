import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsObject, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class NodePositionDto {
    @IsNotEmpty()
    @IsNumber()
    x: number;

    @IsNotEmpty()
    @IsNumber()
    y: number;
}

class NodeMeasuredDto {
    @IsNotEmpty()
    @IsNumber()
    width: number;

    @IsNotEmpty()
    @IsNumber()
    height: number;
}

class NodeDataDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  type?: string;
}
export class NodeDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsString()
  @IsNotEmpty()
  type: string;

  @IsObject()
  @ValidateNested()
  @Type(() => NodePositionDto)
  position: NodePositionDto;

  @IsObject()
  @ValidateNested()
  @Type(() => NodeDataDto)
  data: NodeDataDto;

  @IsObject()
  @ValidateNested()
  @Type(() => NodeMeasuredDto)
  measured: NodeMeasuredDto;

  @IsBoolean()
  selected?: boolean;

  @IsBoolean()
  dragging?: boolean;
}