import type { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: Record<string, unknown> | null;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = (req as Request & { requestId?: string }).requestId || 'unknown';

  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        request_id: requestId,
      },
    });
    return;
  }

  // Handle Multer upload errors cleanly
  if (err && typeof err === 'object' && 'code' in err) {
    const multerCode = String((err as { code?: unknown }).code);
    if (multerCode === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: {
          code: 'FILE_TOO_LARGE',
          message: 'Uploaded file exceeds the 20 MB maximum size limit.',
          details: { max_upload_mb: 20 },
          request_id: requestId,
        },
      });
      return;
    }
  }

  console.error(`[${requestId}] Unhandled server error:`, err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected internal error occurred.',
      details: null,
      request_id: requestId,
    },
  });
}
