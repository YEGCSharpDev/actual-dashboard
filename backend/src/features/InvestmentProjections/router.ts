/**
 * @file backend/src/features/InvestmentProjections/router.ts
 * @description Express router for the Investment Projections feature slice.
 * Exposes the baseline configuration and initial server-side calculated projections.
 */

import { Router, Request, Response } from 'express';
import { InvestmentProjectionsService } from './service.js';

export const investmentProjectionsRouter = Router();
const service = new InvestmentProjectionsService();

/**
 * GET /api/investment-projections/baseline
 * Fetches the investment baseline balances, configuration, and default projections.
 */
import { asyncHandler } from '../../shared/middleware/errorHandler.js';

investmentProjectionsRouter.get('/baseline', asyncHandler(async (req: Request, res: Response) => {
  const payload = await service.getProjectionsData();
  res.json(payload);
}));
