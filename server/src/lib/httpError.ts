// Shared structured-error base for service functions. Routes translate
// `statusCode` into the HTTP response (see index.ts's error handler) instead
// of every service module inventing its own ad-hoc error shape.

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
