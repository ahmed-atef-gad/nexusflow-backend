import { IsArray, IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { NodeDto } from './nodeDto';
import { EdgeDto } from './edgeDto';
import { ViewportDto } from './viewPortDto';
import { ApiProperty } from '@nestjs/swagger';


export class UpdateFlowDto {
  @IsOptional()
  @IsString()
  @ApiProperty({ example: 'My Flow' })
  name: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NodeDto)
  @ApiProperty({ type: [NodeDto] })
  nodes: NodeDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EdgeDto)
  @ApiProperty({ type: [EdgeDto] })
  edges: EdgeDto[];

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ViewportDto)
  @ApiProperty({ type: ViewportDto })
  viewport: ViewportDto;
}