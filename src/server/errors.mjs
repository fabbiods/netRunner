export class ApplicationError extends Error {
  constructor(message, { code = 'application_error', details, statusCode = 400 } = {}) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
    this.details = details;
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends ApplicationError {
  constructor(resource) {
    super(`${resource} not found`, { code: 'not_found', statusCode: 404 });
  }
}

export class ConflictError extends ApplicationError {
  constructor(message, details) {
    super(message, { code: 'conflict', details, statusCode: 409 });
  }
}
