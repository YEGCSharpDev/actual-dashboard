import { Router } from 'express';
import { DashboardSummaryService } from './service.js';

export const dashboardSummaryRouter = Router();
const service = new DashboardSummaryService();

dashboardSummaryRouter.get('/', async (req, res) => {
  const month = req.query.month as string;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "Query parameter 'month' in YYYY-MM format is required" });
  }

  try {
    const data = await service.getDashboard(month);
    res.json(data);
  } catch (err: any) {
    console.error("DashboardSummary fetch failed:", err);
    res.status(500).json({ error: err.message || String(err) });
  }
});
