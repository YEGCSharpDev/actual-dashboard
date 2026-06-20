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
cashflowSankeyRouter.get('/', async (req, res) => {
  try {
    const month = req.query.month as string;
    if (!month) {
      res.status(400).json({ error: 'month query parameter is required' });
      return;
    }
    const data = await service.getSankeyData(month);
    res.json(data);
  } catch (error) {
    console.error('Error fetching cashflow sankey payload:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});
