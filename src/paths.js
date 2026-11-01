import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve all application paths from the project, regardless of the terminal directory.
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONFIG_DIR = path.join(PROJECT_ROOT, 'config');
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
export const AUTH_DIR = path.join(DATA_DIR, 'auth');
export const QUEUE_DIR = path.join(DATA_DIR, 'queue');
export const ARTIFACTS_DIR = path.join(DATA_DIR, 'artifacts');
export const SCREENSHOTS_DIR = path.join(ARTIFACTS_DIR, 'screenshots');
export const DOWNLOADS_DIR = path.join(PROJECT_ROOT, 'downloads');
export const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');
export const SLIDESHOW_CONFIG_FILE = path.join(CONFIG_DIR, 'tiktok-slideshow.config.json');
