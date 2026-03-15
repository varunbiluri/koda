export const VERSION = '0.1.1';
export const KODA_DIR = '.koda';

export const DEFAULT_IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  '.koda',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'coverage',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  'venv',
  '.venv',
  'env',
  '.env',
  '.tox',
  'vendor',
  '.DS_Store',
  'Thumbs.db',
  '*.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.bundle.js',
];

export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.wav', '.avi', '.mov',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.exe', '.dll', '.so', '.dylib', '.o', '.obj',
  '.pyc', '.pyo', '.class', '.jar',
  '.wasm',
]);

export const MAX_FILE_SIZE = 1024 * 1024; // 1MB
export const MAX_CHUNK_LINES = 2000;
