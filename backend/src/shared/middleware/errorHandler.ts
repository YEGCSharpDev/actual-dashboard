import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async route handler to catch errors and pass them to the global error handler.
 */
export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): RequestHandler => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Global error handling middleware.
 * Ensures consistent error responses across all feature slices.
 */
export const globalErrorHandler = (err: unknown, req: Request, res: Response, next: NextFunction) => {
  console.error(`[Router Error] ${req.method} ${req.originalUrl}:`, err);
  
  const errorMessage = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: errorMessage || 'Internal server error' });
};
