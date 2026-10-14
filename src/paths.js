import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Runtime data is independent of the source tree and the terminal working directory.
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
