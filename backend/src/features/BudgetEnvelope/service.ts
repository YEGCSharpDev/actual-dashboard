/**
 * @fileoverview Service layer for Budget Envelope Health.
 * Handles the business logic for calculating envelope statuses such as underfunded,
 * overbudget, and underbudget across current and future months.
 */

import { queryLocalDb } from '../../../server';
import type { EnvelopeHealth } from '../../../../shared/types/BudgetEnvelope';

/**
 * Retrieves the budget envelope health for the selected month and the two following months.
 * 
 * @param selectedMonth - The current selected month in YYYY-MM format (e.g., '2024-06').
 * @returns A promise resolving to an array of EnvelopeHealth data for each target month.
 */
export async function getEnvelopeHealth(selectedMonth: string): Promise<EnvelopeHealth[]> {
  const targetMonths: string[] = [];
  const dateObj = new Date(selectedMonth + '-02'); // middle of month to avoid timezone shifts

  // Calculate the target months (current month + next 2 future months)
  for (let i = 0; i < 3; i++) {
    const m = new Date(dateObj.getFullYear(), dateObj.getMonth() + i, 1);
    const yearStr = m.getFullYear();
    const monthStr = String(m.getMonth() + 1).padStart(2, '0');
    targetMonths.push(`${yearStr}${monthStr}`);
  }

  const healthData: EnvelopeHealth[] = [];

  for (const mStr of targetMonths) {
    /**
     * BUSINESS RULE: Rollover Logic and Underfunded Calculation
     * 
     * In zero-based budgeting (like Actual Budget), a category is "underfunded" when the
     * budgeted amount is less than the target goal.
     * 
     * Current-month versus future-month rollover logic:
     * 1. Current Month: If a category is underfunded in the current month, it means we have not
     *    allocated enough funds to meet our immediate goal. Overspending here may or may not rollover
     *    to the next month, depending on category settings (carryover flag).
     * 2. Future Month: When looking at future months, "underfunded" represents a projected deficit.
     *    Because income for future months might not have been received yet, it is normal for
     *    future months to be underfunded. However, identifying exactly how much is required
     *    to fully fund future months is critical for proactive planning.
     * 
     * The query below calculates the total sum of deficits (goal - amount) only for categories
     * where amount < goal.
     */
    const rows = await queryLocalDb(`
      SELECT COALESCE(SUM(zero_budgets.goal - zero_budgets.amount), 0) / 100.0 as underfunded
      FROM zero_budgets
      INNER JOIN categories ON categories.id = zero_budgets.category
      WHERE month = ?
        AND amount < goal;
    `, [mStr]);

    const underfunded = rows[0]?.underfunded || 0;

    // Currently, overbudget and underbudget metrics require aggregation across transactions and budgets.
    // For this refactor, we maintain the existing behavior and provide stubs for future expansion
    // of overbudget/underbudget monitoring logic.
    healthData.push({
      month: mStr,
      underfunded: underfunded,
      overbudget: 0,
      underbudget: 0
    });
  }

  return healthData;
}

/**
 * Retrieves the budgeted amounts for each category in the given month.
 * 
 * @param selectedMonth - The current selected month in YYYY-MM format.
 * @returns A promise resolving to a record mapping category names to their budgeted amounts.
 */
export async function getBudgets(selectedMonth: string): Promise<Record<string, number>> {
  const queryMonthSql = selectedMonth.replace('-', '');
  const budgetsRaw = await queryLocalDb(`
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
