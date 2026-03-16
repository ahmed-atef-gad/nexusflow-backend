import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsOptional, IsString } from 'class-validator';
import { Edge } from 'src/flows/schemas/edge.schema';
import { Node } from 'src/flows/schemas/node.schema';
import { Viewport } from 'src/flows/schemas/viewport.schema';

export class CreateFlowTemplateDto {
  @ApiProperty({ example: 'Smart Home Lighting Starter' })
  @IsString()
  name: string;

  @ApiPropertyOptional({
    example: 'Template flow for motion-triggered home lighting.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['smart-home', 'lighting'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiProperty({ type: [Node], description: 'Flow nodes to store in the template' })
  @IsArray()
  @ArrayMinSize(1)
  nodes: Node[];

  @ApiProperty({ type: [Edge], description: 'Flow edges to store in the template' })
  @IsArray()
  edges: Edge[];

  @ApiPropertyOptional({ type: Viewport })
  @IsOptional()
  viewport?: Viewport;
}
