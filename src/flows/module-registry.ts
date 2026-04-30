export type ModulePorts = 'source' | 'target' | 'both';

export type ModuleDefinition = {
  id: string;
  name: string;
  ports?: ModulePorts;
  pinMode?:
    | 'INPUT'
    | 'OUTPUT'
    | 'INPUT_PULLUP'
    | 'ANALOG'
    | 'PWM'
    | 'DAC'
    | 'SERVO';
  type?: string;
};

export const MODULE_DEFINITIONS: ModuleDefinition[] = [
  {
    id: 'logic-function',
    name: 'Function',
    ports: 'both',
  },
  {
    id: 'mqtt-in',
    name: 'Flow Bridge In',
    ports: 'source',
  },
  {
    id: 'mqtt-out',
    name: 'Flow Bridge Out',
    ports: 'target',
  },
  {
    id: 'ESP32-gpio-input',
    name: 'Digital Input',
    ports: 'source',
    pinMode: 'INPUT',
  },
  {
    id: 'ESP32-gpio-input-pullup',
    name: 'Digital Input (Pullup)',
    ports: 'source',
    pinMode: 'INPUT_PULLUP',
  },
  {
    id: 'ESP32-gpio-input-analog',
    name: 'Analog Input',
    ports: 'source',
    pinMode: 'ANALOG',
  },
  {
    id: 'ESP32-gpio-output',
    name: 'Digital Output',
    ports: 'target',
    pinMode: 'OUTPUT',
  },
  {
    id: 'ESP32-gpio-output-pwm',
    name: 'PWM Output',
    ports: 'target',
    pinMode: 'PWM',
  },
  {
    id: 'ESP32-gpio-output-dac',
    name: 'DAC Output',
    ports: 'target',
    pinMode: 'DAC',
  },
  {
    id: 'ESP32-gpio-output-servo',
    name: 'Servo Output',
    ports: 'target',
    pinMode: 'SERVO',
  },
  {
    id: 'ESP32-gpio-output-led',
    name: 'LED',
    ports: 'target',
    pinMode: 'OUTPUT',
  },
  {
    id: 'DHT-Sensor-11',
    name: 'DHT11',
    ports: 'source',
  },
  {
    id: 'DHT-Sensor-22',
    name: 'DHT22',
    ports: 'source',
  },
  {
    id: 'PIR-Sensor',
    name: 'PIR Sensor',
    ports: 'source',
  },
  {
    id: 'MQ2-Sensor',
    name: 'MQ2 Sensor',
    ports: 'source',
  },
  {
    id: 'Rain-Sensor',
    name: 'Rain Sensor',
    ports: 'source',
  },
  {
    id: 'Soil-Sensor',
    name: 'Soil Sensor',
    ports: 'source',
  },
  {
    id: 'Ultrasonic-Sensor',
    name: 'Ultrasonic',
    ports: 'source',
  },
];

export const MODULE_DEFINITION_BY_ID = new Map(
  MODULE_DEFINITIONS.map((definition) => [definition.id, definition] as const)
);
