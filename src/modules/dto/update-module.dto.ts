import { PartialType } from '@nestjs/mapped-types';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CreateModuleDto } from './create-module.dto';

export class UpdateModuleDto extends PartialType(CreateModuleDto) {
  @ApiPropertyOptional({
    description: 'The name of the module',
    example: 'ESP32 GPIO Controller',
  })
  name?: string;

  @ApiPropertyOptional({
    description: 'The icon representing the module (Lucide icon name)',
    example: 'Cpu',
  })
  icon?: string;

  @ApiPropertyOptional({
    description: 'The gradient color class for UI display',
    example: 'from-green-400 to-blue-500',
  })
  color?: string;

  @ApiPropertyOptional({
    description: 'Module category such as "Sensors", "Actuators", etc.',
    example: 'GPIO',
  })
  category?: string;

  @ApiPropertyOptional({
    description: 'Port behavior: source, target, or both',
    example: 'source',
  })
  ports?: 'source' | 'target' | 'both';

  @ApiPropertyOptional({
    description: 'Optional alias for module type',
    example: 'ESP32_GPIO',
  })
  alias?: string;

  @ApiPropertyOptional({
    description: 'Developer notes about module functionality',
    example: 'Used to control GPIO pins via MQTT commands',
  })
  notes?: string;

  @ApiPropertyOptional({
    description: 'Key-value options for module configuration',
    example: {
      pin: 'D5',
      mode: 'OUTPUT',
    },
  })
  options?: Record<string, any>;

  @ApiPropertyOptional({
    description: 'Runtime variable bindings for module fields',
    example: {
      value: 'ON',
      voltage: '3.3V',
    },
  })
  variables?: Record<string, string>;
}
