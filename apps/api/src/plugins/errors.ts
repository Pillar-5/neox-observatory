import type { FastifyPluginAsync } from 'fastify';

/**
 * Uniform JSON error shape.
 *
 * Every error response carries `error` with a machine code and a human message,
 * plus `requestId` so a log line and a client error can be correlated. Stack
 * traces are never included, so an internal failure does not leak file paths or
 * dependency details to a public caller.
 */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
  requestId: string;
}

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const errorHandlerPlugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    if (error instanceof ApiError) {
      const body: ApiErrorBody = {
        error: { code: error.code, message: error.message },
        requestId,
      };
      reply.status(error.statusCode).send(body);
      return;
    }

    // Fastify attaches statusCode and a validation array for schema failures.
    const statusCode =
      typeof (error as { statusCode?: number }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;

    if (statusCode >= 500) {
      request.log.error({ err: error, requestId }, 'unhandled API error');
      const body: ApiErrorBody = {
        error: {
          code: 'internal_error',
          message: 'The server encountered an unexpected error.',
        },
        requestId,
      };
      reply.status(500).send(body);
      return;
    }

    const validation = (error as { validation?: unknown }).validation;
    const body: ApiErrorBody = {
      error: {
        code: statusCode === 429 ? 'rate_limited' : 'bad_request',
        message:
          statusCode === 429
            ? 'Too many requests. Slow down and retry shortly.'
            : validation
              ? 'Request failed validation.'
              : error.message,
      },
      requestId,
    };
    reply.status(statusCode).send(body);
  });

  app.setNotFoundHandler((request, reply) => {
    const body: ApiErrorBody = {
      error: { code: 'not_found', message: `No route for ${request.method} ${request.url}` },
      requestId: request.id,
    };
    reply.status(404).send(body);
  });
};
