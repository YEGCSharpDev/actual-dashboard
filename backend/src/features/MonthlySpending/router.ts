/**
 * @file backend/src/features/MonthlySpending/router.ts
 * @description Express router exposing endpoints for the Monthly Spending Analytics feature.
 * Maps HTTP requests to the MonthlySpendingService methods.
 */

import { Router, Request, Response } from 'express';
import { MonthlySpendingService } from './service';

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
router.get('/', async (req: Request, res: Response) => {
  const month = req.query.month as string;

  // Validate the format of the month parameter (must be YYYY-MM)
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({
      error: "Query parameter 'month' in YYYY-MM format is required."
    });
  }

  try {
    const payload = await service.getMonthlySpending(month);
    return res.json(payload);
  } catch (err: any) {
    console.error(`[Router - MonthlySpending] Failed to retrieve data for month ${month}:`, err);
    return res.status(500).json({
      error: err.message || "Failed to load monthly spending data"
    });
  }
});

export { router as monthlySpendingRouter };
