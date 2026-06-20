/**
 * @fileoverview Express router for the Budget Envelope feature.
 * Exposes endpoints to retrieve envelope health data.
 */

import { Router, Request, Response } from 'express';
import { BudgetEnvelopeService } from './service.js';
import type { BudgetEnvelopeHealthResponse } from '../../../../shared/types/BudgetEnvelope';

export const budgetEnvelopeRouter = Router();
const service = new BudgetEnvelopeService();

/**
 * GET /health
 * Retrieves the budget envelope health (underfunded, overbudget, underbudget)
 * for the specified month and future months.
 * 
 * Query Params:
 * - month (string): The selected month in YYYY-MM format.
 */
import { requireMonthParam } from '../../shared/middleware/validateMonth.js';
import { asyncHandler } from '../../shared/middleware/errorHandler.js';

budgetEnvelopeRouter.get('/health', requireMonthParam, asyncHandler(async (req: Request, res: Response) => {
  const selectedMonth = req.query.month as string;
  const healthData = await service.getEnvelopeHealth(selectedMonth);
  
  const responsePayload: BudgetEnvelopeHealthResponse = {
    healthData
  };

  res.json(responsePayload);
}));
