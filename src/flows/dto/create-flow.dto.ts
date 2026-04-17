import {
  IsString,
  IsArray,
  IsObject,
  IsNumber,
  ValidateNested,
  IsOptional,
  IsBoolean,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class PositionDto {
  @ApiProperty({ example: 0, description: 'X coordinate' })
  @IsNumber()
  x!: number;

  @ApiProperty({ example: 0, description: 'Y coordinate' })
  @IsNumber()
  y!: number;
}

export class MeasuredDto {
  @ApiProperty({ example: 100, description: 'Node width' })
  @IsNumber()
  width!: number;

  @ApiProperty({ example: 50, description: 'Node height' })
  @IsNumber()
  height!: number;
}

export class NodeDataDto {
  @ApiProperty({ description: 'Data ID', required: false })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ description: 'Node name' })
  @IsString()
  name!: string;

  @ApiProperty({ description: 'Module ID' })
  @IsString()
  moduleId!: string;

  @ApiProperty({ description: 'Node alias', required: false })
  @IsOptional()
  @IsString()
  alias?: string;

  @ApiProperty({ description: 'Pin mode', required: false })
  @IsOptional()
  @IsString()
  pinMode?: string;

  @ApiProperty({ description: 'Node type', required: false })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiProperty({ description: 'Ports', required: false })
  @IsOptional()
  @IsString()
  ports?: string;

  @ApiProperty({ description: 'Icon data', required: false })
  @IsOptional()
  icon?: any;

  @ApiProperty({ description: 'Color', required: false })
  @IsOptional()
  @IsString()
  color?: string;

  @ApiProperty({ description: 'Category', required: false })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({ description: 'Notes', required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ description: 'Node options', required: false })
  @IsOptional()
  options?: any;

  @ApiProperty({ description: 'Variables', required: false })
  @IsOptional()
  @IsObject()
  variables?: Record<string, string | number | boolean>;

  @ApiProperty({ description: 'Node warnings', required: false, type: [Object] })
  @IsOptional()
  warnings?: unknown[];

  @ApiProperty({ description: 'Node errors', required: false, type: [Object] })
  @IsOptional()
  errors?: unknown[];
}

export class CreateNodeDto {
  @ApiProperty({ description: 'Node ID' })
  @IsString()
  id!: string;

  @ApiProperty({ description: 'Node type' })
  @IsString()
  type!: string;

  @ApiProperty({ type: PositionDto, description: 'Node position' })
  @ValidateNested()
  @Type(() => PositionDto)
  position!: PositionDto;

  @ApiProperty({ type: NodeDataDto, description: 'Node data' })
  @ValidateNested()
  @Type(() => NodeDataDto)
  data!: NodeDataDto;

  @ApiProperty({
    type: MeasuredDto,
    description: 'Node dimensions',
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => MeasuredDto)
  measured?: MeasuredDto;

  @ApiProperty({ description: 'Is selected', required: false })
  @IsOptional()
  @IsBoolean()
  selected?: boolean;

  @ApiProperty({ description: 'Is dragging', required: false })
  @IsOptional()
  @IsBoolean()
  dragging?: boolean;
}

export class CreateEdgeDto {
  @ApiProperty({ description: 'Edge ID' })
  @IsString()
  id!: string;

  @ApiProperty({ description: 'Source node ID' })
  @IsString()
  source!: string;

  @ApiProperty({ description: 'Target node ID' })
  @IsString()
  target!: string;

  @ApiProperty({ description: 'Is animated', required: false })
  @IsOptional()
  @IsBoolean()
  animated?: boolean;
}

export class ViewportDto {
  @ApiProperty({ example: 0, description: 'X coordinate' })
  @IsNumber()
  x!: number;

  @ApiProperty({ example: 0, description: 'Y coordinate' })
  @IsNumber()
  y!: number;

  @ApiProperty({ example: 1, description: 'Zoom level' })
  @IsNumber()
  zoom!: number;
}

export class CreateFlowDto {
  @ApiProperty({ description: 'Flow name' })
  @IsString()
  name!: string;

  @ApiProperty({
    type: [CreateNodeDto],
    description: 'Flow nodes',
    isArray: true,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'Flow must contain at least one node' })
  @ValidateNested({ each: true })
  @Type(() => CreateNodeDto)
  nodes!: CreateNodeDto[];

  @ApiProperty({
    type: [CreateEdgeDto],
    description: 'Flow edges',
    isArray: true,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEdgeDto)
  edges!: CreateEdgeDto[];

  @ApiProperty({
    type: ViewportDto,
    description: 'Viewport state',
    required: false,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ViewportDto)
  viewport?: ViewportDto;
}
