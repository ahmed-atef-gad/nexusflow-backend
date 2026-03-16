import { PartialType } from '@nestjs/swagger';
import { CreateFlowTemplateDto } from './create-flow-template.dto';

export class UpdateFlowTemplateDto extends PartialType(CreateFlowTemplateDto) {}
