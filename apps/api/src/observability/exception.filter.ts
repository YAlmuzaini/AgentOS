import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { ERROR_REPORTER, type ErrorReporter } from "./error-reporter";

/**
 * Reports the API failures that were nobody's plan.
 *
 * Deliberately narrow: a `BadRequestException` from a Zod contract or a 404 for
 * a missing id is the API working, and reporting those turns the error feed
 * into a request log nobody reads. Only 5xx — the ones that mean a bug — are
 * reported. Everything is still answered to the caller unchanged.
 */
@Catch()
export class ReportingExceptionFilter implements ExceptionFilter {
  constructor(@Inject(ERROR_REPORTER) private readonly errors: ErrorReporter) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.errors.capture(exception, {
        scope: "api.request",
        // The path only — a query string or body can carry anything.
        tags: { method: request.method, route: request.route?.path ?? request.path, status },
      });
    }

    const body =
      exception instanceof HttpException
        ? exception.getResponse()
        : { statusCode: status, message: "Internal server error" };

    response.status(status).json(body);
  }
}
