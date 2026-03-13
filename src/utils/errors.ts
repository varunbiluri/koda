export enum ErrorCode {
  UNKNOWN = 'UNKNOWN',
  INDEX_NOT_FOUND = 'INDEX_NOT_FOUND',
  INDEX_CORRUPTED = 'INDEX_CORRUPTED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  PARSE_ERROR = 'PARSE_ERROR',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  UNSUPPORTED_LANGUAGE = 'UNSUPPORTED_LANGUAGE',
  INVALID_QUERY = 'INVALID_QUERY',
}

export class KodaError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'KodaError';
  }
}
