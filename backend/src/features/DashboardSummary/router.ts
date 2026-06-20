import { Router } from 'express';
import { DashboardSummaryService } from './service.js';

export const dashboardSummaryRouter = Router();
const service = new DashboardSummaryService();

import { requireMonthParam } from '../../shared/middleware/validateMonth.js';
import { asyncHandler } from '../../shared/middleware/errorHandler.js';

dashboardSummaryRouter.get('/', requireMonthParam, asyncHandler(async (req, res) => {
  const month = req.query.month as string;
  const data = await service.getDashboard(month);
  res.json(data);
}));
