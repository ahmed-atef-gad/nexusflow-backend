import { IsString, IsNotEmpty, IsArray, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { NodeDto } from './nodeDto';
import { EdgeDto } from './edgeDto';
import { ViewportDto } from './viewPortDto';
import { ApiProperty } from '@nestjs/swagger';

export class CreateFlowDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ example: 'My Flow' })
  name: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NodeDto)
  @ApiProperty({ type: [NodeDto] })
  nodes: NodeDto[];
      
  @IsArray()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EdgeDto)
  @ApiProperty({ type: [EdgeDto] })
  edges: EdgeDto[];

  @IsObject()
  @ValidateNested()
  @Type(() => ViewportDto)
  @ApiProperty({ type: ViewportDto })
  viewport: ViewportDto;
}