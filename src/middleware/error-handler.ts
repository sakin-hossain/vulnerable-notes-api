import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { env } from '../config/env';

export class AppError extends Error {
  readonly statusCode: number;
  readonly code?: string;

  constructor(statusCode: number, message: string, code?: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', code = 'BAD_REQUEST') {
    super(400, message, code);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    super(401, message, code);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code = 'FORBIDDEN') {
    super(403, message, code);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', code = 'NOT_FOUND') {
    super(404, message, code);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', code = 'CONFLICT') {
    super(409, message, code);
  }
}

type BodyParserError = Error & { type: string; statusCode: number };

function isBodyParserError(err: unknown): err is BodyParserError {
  return (
    err instanceof Error &&
    typeof (err as Partial<BodyParserError>).type === 'string' &&
    (err as BodyParserError).type.startsWith('entity.') &&
    typeof (err as Partial<BodyParserError>).statusCode === 'number'
  );
}

type ErrorDetail = { path: string; message: string };

type ErrorEnvelope = {
  error: {
    message: string;
    code?: string;
    details?: ErrorDetail[];
  };
};

export function notFoundHandler(req: Request, res: Response): void {
  const envelope: ErrorEnvelope = {
    error: { message: `Route not found: ${req.method} ${req.originalUrl}`, code: 'NOT_FOUND' },
  };
  res.status(404).json(envelope);
}

// The 4-argument signature is required for Express to recognise this as an
// error-handling middleware, even though `next` is never called.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    const details: ErrorDetail[] = err.issues.flatMap((issue) => {
      // A rejected unknown key carries the offending names in `keys`, not in
      // `path`. Surfacing them individually is what makes a blocked
      // `{"role":"ADMIN"}` read as `role` instead of an anonymous root error.
      if (issue.code === 'unrecognized_keys') {
        return issue.keys.map((key) => ({
          path: key,
          message: `Unrecognized key: "${key}"`,
        }));
      }
      return [{ path: issue.path.join('.') || '(root)', message: issue.message }];
    });
    respond(res, 400, { message: 'Validation failed', code: 'VALIDATION_ERROR', details }, err);
    return;
  }

  if (err instanceof AppError) {
    respond(res, err.statusCode, { message: err.message, code: err.code }, err);
    return;
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    respond(res, 400, { message: 'Request body is not valid', code: 'BAD_REQUEST' }, err);
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      respond(
        res,
        409,
        { message: 'A record with this value already exists', code: 'CONFLICT' },
        err,
      );
      return;
    }
    if (err.code === 'P2025') {
      respond(res, 404, { message: 'Not found', code: 'NOT_FOUND' }, err);
      return;
    }
  }

  // body-parser rejects unparseable or oversized payloads before any handler
  // runs. These are client mistakes, so they must not surface as a 500.
  if (isBodyParserError(err)) {
    const status = err.statusCode;
    const code = status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_JSON';
    const message = status === 413 ? 'Request body is too large' : 'Request body is not valid JSON';
    respond(res, status, { message, code }, err);
    return;
  }

  respond(res, 500, { message: 'Internal server error', code: 'INTERNAL_ERROR' }, err);
}

function respond(
  res: Response,
  statusCode: number,
  body: { message: string; code?: string; details?: ErrorDetail[] },
  originalError: unknown,
): void {
  // Stack traces go to the operator's terminal, never to the client — in
  // either lab mode. Verbose error responses would be a fourth vulnerability,
  // and this lab deliberately ships only three.
  if (statusCode >= 500) {
    console.error(originalError);
  } else if (env.NODE_ENV === 'development') {
    // First line only, and clamped. Prisma's messages embed the offending
    // query and a source excerpt, which on a screen recording would reveal
    // the vulnerable function before it has been explained.
    const raw = originalError instanceof Error ? originalError.message : String(originalError);
    const summary = raw.split('\n')[0]?.slice(0, 120) ?? '';
    console.error(`${statusCode} ${body.code ?? ''} ${summary}`.trim());
  }

  res.status(statusCode).json({ error: { ...body } } satisfies ErrorEnvelope);
}
