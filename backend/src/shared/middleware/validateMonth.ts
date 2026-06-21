import type { Request, Response, NextFunction } from 'express';

export const requireMonthParam = (req: Request, res: Response, next: NextFunction) => {
  const month = req.query.month as string;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "Query parameter 'month' in YYYY-MM format is required." });
    return;
  }
  next();
};
