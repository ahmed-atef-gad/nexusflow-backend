import { IsArray, IsBoolean, IsNotEmpty, IsObject, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { NodeDto } from './nodeDto';
import { EdgeDto } from './edgeDto';
import { ViewportDto } from './viewPortDto';



export class UpdateFlowDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => NodeDto)
  nodes: NodeDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EdgeDto)
  edges: EdgeDto[];

  @IsObject()
  @ValidateNested()
  @Type(() => ViewportDto)
  viewport: ViewportDto;
}