import { IsArray, IsBoolean, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

class NodePositionDto {
    @IsNotEmpty()
    @IsNumber()
    @ApiProperty({ example: 100 })
    x: number;

    @IsNotEmpty()
    @IsNumber()
    @ApiProperty({ example: 200 })
    y: number;
}

class NodeMeasuredDto {
    @IsNotEmpty()
    @IsNumber()
    @ApiProperty({ example: 300 })
    width: number;

    @IsNotEmpty()
    @IsNumber()
    @ApiProperty({ example: 400 })
    height: number;
}

class NodeDataDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'Sample Node' })
  id: string;

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'Sample Node' })
  name: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ example: 'custom-type', required: false })
  type?: string;
}
export class NodeDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'node-1' })
  id: string;

  @IsOptional()
  @IsString()
  @ApiProperty({ example: 'custom-type', required: false })
  type?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => NodePositionDto)
  @ApiProperty({ type: NodePositionDto })
  position: NodePositionDto;

  @IsObject()
  @ValidateNested()
  @Type(() => NodeDataDto)
  @ApiProperty({ type: NodeDataDto })
  data: NodeDataDto;

  @IsObject()
  @ValidateNested()
  @Type(() => NodeMeasuredDto)
  @ApiProperty({ type: NodeMeasuredDto })
  measured: NodeMeasuredDto;

  @IsBoolean()
  @ApiProperty({ example: true })
  selected?: boolean;

  @IsBoolean()
  @ApiProperty({ example: false })
  dragging?: boolean;
}