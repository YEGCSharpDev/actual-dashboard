/**
 * @file backend/src/features/TFSAContributions/router.ts
 * @description Express router for the TFSA Contributions feature slice.
 * Exposes the YTD limit, total room, and chart data calculations to the frontend.
 */

import { Router, Request, Response } from 'express';
import { TFSAContributionsService } from './service.js';

export const tfsaContributionsRouter = Router();
const service = new TFSAContributionsService();

/**
 * GET /api/tfsa-contributions/ytd
 * Fetches YTD TFSA Contributions analytics and velocity chart data.
 */
tfsaContributionsRouter.get('/ytd', async (req: Request, res: Response) => {
  try {
    const payload = await service.getYearToDateContributions();
    res.json(payload);
  } catch (error: any) {
    console.error('[TFSA Contributions] Error fetching YTD data:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});
