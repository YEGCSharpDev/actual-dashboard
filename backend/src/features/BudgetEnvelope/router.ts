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
budgetEnvelopeRouter.get('/health', async (req: Request, res: Response) => {
  try {
    const selectedMonth = req.query.month as string;
    
    if (!selectedMonth) {
      return res.status(400).json({ error: 'month query parameter is required (YYYY-MM)' });
    }

    const healthData = await service.getEnvelopeHealth(selectedMonth);
    
    const responsePayload: BudgetEnvelopeHealthResponse = {
      healthData
    };

    res.json(responsePayload);
  } catch (error: any) {
    console.error('Error fetching budget envelope health:', error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});
