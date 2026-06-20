/**
 * @file backend/src/features/CashflowSankey/router.ts
 * @description Express router for the Cashflow Sankey feature slice.
 * Exposes an endpoint to fetch pre-calculated Sankey layout data.
 */

import { Router } from 'express';
import { CashflowSankeyService } from './service.js';

export const cashflowSankeyRouter = Router();
const service = new CashflowSankeyService();

/**
 * GET /api/cashflow-sankey
 * Fetches the computed nodes and links for the Sankey visualization.
 * Query Params:
 * - month (required): YYYY-MM format.
 */
import { requireMonthParam } from '../../shared/middleware/validateMonth.js';
import { asyncHandler } from '../../shared/middleware/errorHandler.js';

cashflowSankeyRouter.get('/', requireMonthParam, asyncHandler(async (req, res) => {
  const month = req.query.month as string;
  const data = await service.getSankeyData(month);
  res.json(data);
}));
