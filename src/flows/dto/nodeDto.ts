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
  @IsOptional()
  @IsString()
  @ApiProperty({ example: 'port-1,port-2', required: false })
  ports?: string;
  @IsOptional()
  @IsObject()
  @ApiProperty({ example: { url: 'icon-url', size: 24 }, required: false })
  icon?: any;
  @IsOptional()
  @IsString()
  @ApiProperty({ example: '#FF5733', required: false })
  color?: string
  @IsOptional()
  @IsString()
  @ApiProperty({ example: 'category-1', required: false })
  category?: string
  @IsOptional()
  @IsObject()
  @ApiProperty({ example: { option1: true, option2: 'value' }, required: false })
  options?: any
  @IsOptional()
  @IsObject()
  @ApiProperty({ example: { var1: 123, var2: 'data' }, required: false })
  variables?: any;
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