import { resolve } from 'path';

export const FIRMWARE_UPLOAD_DIR = resolve(
  process.cwd(),
  'uploads',
  'firmware'
);
