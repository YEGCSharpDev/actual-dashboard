/**
 * @file backend/src/features/MonthlySpending/router.ts
 * @description Express router exposing endpoints for the Monthly Spending Analytics feature.
 * Maps HTTP requests to the MonthlySpendingService methods.
 */

import { Router, Request, Response } from 'express';
import { MonthlySpendingService } from './service.js';

const router = Router();
const service = new MonthlySpendingService();

/**
 * GET /api/monthly-spending
 * Exposes the monthly spending analytics summary.
 * 
 * Query parameters:
 *   - month: string (Required, format YYYY-MM)
 * 
 * Response flow:
 *   1. Validate the presence and YYYY-MM format of the 'month' parameter.
 *   2. Call the service layer to pull and calculate the aggregates.
 *   3. Return a 200 OK JSON response containing the MonthlySpendingPayload.
 *   4. Handle and log database or calculation errors, returning a 500 status.
 */
import { requireMonthParam } from '../../shared/middleware/validateMonth.js';
import { asyncHandler } from '../../shared/middleware/errorHandler.js';

router.get('/', requireMonthParam, asyncHandler(async (req: Request, res: Response) => {
  const month = req.query.month as string;
  const payload = await service.getMonthlySpending(month);
  res.json(payload);
}));

export { router as monthlySpendingRouter };
