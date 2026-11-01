import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';

@Catch()
export class DatabaseErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      const body = error.getResponse();
      response
        .status(error.getStatus())
        .json(
          typeof body === 'string'
            ? { statusCode: error.getStatus(), message: body }
            : body,
        );
      return;
    }
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'The operation could not be completed.';
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        message = 'A record with these identifying values already exists.';
      } else if (error.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        message = 'The requested record was not found.';
      } else if (['P2003', 'P2004'].includes(error.code)) {
        status = HttpStatus.CONFLICT;
        message = 'The operation conflicts with related financial records.';
      } else if (['P1001', 'P1002', 'P2024', 'P2028'].includes(error.code)) {
        status = HttpStatus.SERVICE_UNAVAILABLE;
        message = 'The database is temporarily unavailable. Retry later.';
      }
    }
    response.status(status).json({ statusCode: status, message });
  }
}
