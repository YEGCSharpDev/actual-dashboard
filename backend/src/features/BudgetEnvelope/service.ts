/**
 * @fileoverview Service layer for Budget Envelope Health.
 * Handles the business logic for calculating envelope statuses such as underfunded,
 * overbudget, and underbudget across current and future months.
 */

import type { IDbClient } from '../../infrastructure/db/IDbClient.js';
import { defaultDbClient } from '../../db/client.js';
import type { EnvelopeHealth } from '../../../../shared/types/BudgetEnvelope.js';

export class BudgetEnvelopeService {
  constructor(private db: IDbClient = defaultDbClient) {}

/**
 * Retrieves the budget envelope health for the selected month and the two following months.
 * 
 * @param selectedMonth - The current selected month in YYYY-MM format (e.g., '2024-06').
 * @returns A promise resolving to an array of EnvelopeHealth data for each target month.
 */
  public async getEnvelopeHealth(selectedMonth: string): Promise<EnvelopeHealth[]> {
  const targetMonths: string[] = [];
  const dateObj = new Date(selectedMonth + '-02'); // middle of month to avoid timezone shifts

  // Calculate the target months (current month + next 2 future months)
  for (let i = 0; i < 3; i++) {
    const m = new Date(dateObj.getFullYear(), dateObj.getMonth() + i, 1);
    const yearStr = m.getFullYear();
    const monthStr = String(m.getMonth() + 1).padStart(2, '0');
    targetMonths.push(`${yearStr}${monthStr}`);
  }

  const rows = await this.db.query(`
    SELECT month, COALESCE(SUM(zero_budgets.goal - zero_budgets.amount), 0) / 100.0 as underfunded
    FROM zero_budgets
    INNER JOIN categories ON categories.id = zero_budgets.category
    WHERE month IN (?, ?, ?)
      AND amount < goal
    GROUP BY month
  `, targetMonths);

  const healthMap = new Map(rows.map((r: any) => [r.month, r.underfunded]));

  const healthData: EnvelopeHealth[] = targetMonths.map(mStr => ({
    month: mStr,
    underfunded: healthMap.get(mStr) || 0,
    overbudget: 0,
    underbudget: 0
  }));

  return healthData;
}

/**
 * Retrieves the budgeted amounts for each category in the given month.
 * 
 * @param selectedMonth - The current selected month in YYYY-MM format.
 * @returns A promise resolving to a record mapping category names to their budgeted amounts.
 */
  public async getBudgets(selectedMonth: string): Promise<Record<string, number>> {
  const queryMonthSql = selectedMonth.replace('-', '');
    const budgetsRaw = await this.db.query(`
      SELECT c.name, COALESCE(zb.amount, 0) / 100.0 as budgeted
      FROM zero_budgets zb
      INNER JOIN categories c ON c.id = zb.category
      WHERE zb.month = ?
    `, [queryMonthSql]);

  const budgets: Record<string, number> = {};
  budgetsRaw.forEach((b: any) => {
    budgets[b.name] = b.budgeted;
  });

  return budgets;
  }
}
