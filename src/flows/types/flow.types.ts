import { ApiProperty } from '@nestjs/swagger';

export class Position {
  @ApiProperty({ example: 100, description: 'X coordinate' })
  x: number;

  @ApiProperty({ example: 200, description: 'Y coordinate' })
  y: number;
}

export class Module {
  @ApiProperty({ example: 'module-123', description: 'Unique ID for mqtt' })
  id: string;
  @ApiProperty({ example: 'ESP32-gpio-input', description: 'Unique module ID' })
  moduleId: string;

  @ApiProperty({ example: 'ESP32 GPIO Input', description: 'Display name' })
  name: string;

  @ApiProperty({
    example: 'INPUT',
    description: 'Pin Mode',
  })
  pinMode?: string;

  @ApiProperty({
    example: 'from-amber-500 to-orange-500',
    description: 'UI Gradient',
  })
  color: string;

  @ApiProperty({ example: 'Hardware', description: 'Category' })
  category: string;

  @ApiProperty({ enum: ['source', 'target', 'both'], required: false })
  ports?: 'source' | 'target' | 'both';

  @ApiProperty({ required: false })
  type?: string;

  @ApiProperty({ required: false })
  alias?: string;

  @ApiProperty({ required: false })
  notes?: string;

  @ApiProperty({ required: false })
  options?: any;

  @ApiProperty({
    required: false,
    example: { pinMode: 'INPUT', pinNumber: '4' },
  })
  variables?: Record<string, string>;
}

export class ModuleNode {
  @ApiProperty({ example: 'node-123', description: 'Unique Node ID' })
  id: string;

  @ApiProperty({ type: Position })
  position: Position;

  @ApiProperty({ type: Module })
  data: Module;

  @ApiProperty({ required: false })
  type?: string;

  // ... optional UI properties ...
  @ApiProperty({ required: false })
  width?: number | null;
  @ApiProperty({ required: false })
  height?: number | null;
}

export class Edge {
  @ApiProperty({ example: 'edge-1' })
  id: string;

  @ApiProperty({ example: 'node-1' })
  source: string;

  @ApiProperty({ example: 'node-2' })
  target: string;

  @ApiProperty({ required: false })
  sourceHandle?: string | null;

  @ApiProperty({ required: false })
  targetHandle?: string | null;
}

// --- New Types for Setup/Logic APIs ---

export class SetupPayload {
  @ApiProperty({
    example: '64b5f...',
    description: 'The Flow ID this setup belongs to',
  })
  flowId: string;

  @ApiProperty({
    example: [{ cmd: 16, pin: 4, mode: 1 }],
    description: 'Array of setup commands',
  })
  elements: any[];
}

export class LogicPayload {
  @ApiProperty({
    example: '64b5f...',
    description: 'The Flow ID this logic belongs to',
  })
  flowId: string;

  @ApiProperty({
    example: { flows: [[{ id: 'node-1', cmd: 18 }]] },
    description: 'The compiled logic program graph',
  })
  program: any;
}

export class UiPayload {
  @ApiProperty({
    example: '64b5f...',
    description: 'The Flow ID this UI belongs to',
  })
  flowId: string;

  @ApiProperty({
    example: [{ type: 'button', label: 'Turn On', action: 'turn_on' }],
    description: 'Array of UI elements',
  })
  elements: any[];
}
