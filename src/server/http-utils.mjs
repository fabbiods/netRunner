import { ApplicationError } from './errors.mjs';

const DEFAULT_BODY_LIMIT = 12 * 1024 * 1024;

export async function readJsonBody(request, { maximumBytes = DEFAULT_BODY_LIMIT } = {}) {
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || !/^application\/json(?:;|$)/i.test(contentType)) {
    throw new ApplicationError('Content-Type must be application/json', {
      code: 'unsupported_media_type',
      statusCode: 415,
    });
  }

  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new ApplicationError('Request body is too large', {
      code: 'payload_too_large',
      statusCode: 413,
    });
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      throw new ApplicationError('Request body is too large', {
        code: 'payload_too_large',
        statusCode: 413,
      });
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('JSON body must be an object');
    }
    return parsed;
  } catch {
    throw new ApplicationError('Request body contains invalid JSON', {
      code: 'invalid_json',
      statusCode: 400,
    });
  }
}
