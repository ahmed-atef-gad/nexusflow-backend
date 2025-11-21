
export class Position {

  x: number;

  y: number;

}

export class Module {

  id: string;

  name: string;

  color: string;

  category: string;

  ports?: 'source' | 'target' | 'both';

  type?: string;

  alias?: string;

  notes?: string;

  options?: any;

  variables?: Record<string, string>;

}



export class ModuleNode {

  id: string;

  position: Position;

  data: Module;

  type?: string;

  sourcePosition?: 'left' | 'top' | 'right' | 'bottom';

  targetPosition?: 'left' | 'top' | 'right' | 'bottom';

  hidden?: boolean;

  selected?: boolean;

  dragging?: boolean;

  draggable?: boolean;

  selectable?: boolean;

  connectable?: boolean;

  resizing?: boolean;

  focusable?: boolean;

  deletable?: boolean;

  style?: any;

  className?: string;

  width?: number | null;

  height?: number | null;

}



export class Edge {

  id: string;

  source: string;

  target: string;

  sourceHandle?: string | null;

  targetHandle?: string | null;

}


