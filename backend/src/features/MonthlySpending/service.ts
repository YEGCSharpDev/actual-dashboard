/**
 * @file backend/src/features/MonthlySpending/service.ts
 * @description Service containing the business logic and database queries for
 * retrieving monthly spending and income aggregates.
 */

import type { IDbClient } from '../../infrastructure/db/IDbClient.js';
import { defaultDbClient } from '../../../db.js';
import type { MonthlySpendingPayload, SpendingCategorySummary } from '@shared/types/MonthlySpending';

/**
 * Service class for Monthly Spending Analytics.
 * Handles database interaction and aggregation of income/expenses.
 */
export class MonthlySpendingService {
  constructor(private db: IDbClient = defaultDbClient) {}

  /**
   * Retrieves aggregated monthly spending and income analytics for a given month.
   * Filters out transactions on off-budget accounts.
   * 
   * @param selectedMonth The month to query in YYYY-MM format.
   * @returns A promise resolving to the monthly spending analytics payload.
   */
  public async getMonthlySpending(selectedMonth: string): Promise<MonthlySpendingPayload> {
    // In the SQLite DB, dates are stored in YYYYMMDD string format.
    // e.g. "2026-06" becomes "202606" for SQL LIKE operations.
    const queryMonthSql = selectedMonth.replace('-', '');
    
    // Fetch all transactions for the specified month from the on-budget accounts.
    // Exclude deleted (tombstone) and parent transactions.
    const rawTransactions = await this.db.query(`
      SELECT 
        t.id, 
        t.date, 
        t.amount, 
        a.offbudget as account_offbudget,
        p.name as payee_name,
        ta.name as transfer_account_name,
        c.name as category_name, 
        c.is_income as category_is_income
      FROM v_transactions t
      LEFT JOIN accounts a ON t.account = a.id
      LEFT JOIN payees p ON t.payee = p.id
      LEFT JOIN accounts ta ON p.transfer_acct = ta.id
      LEFT JOIN categories c ON t.category = c.id
      WHERE t.tombstone = 0 
        AND t.is_parent = 0
        AND (a.offbudget = 0 OR a.offbudget IS NULL)
        AND t.date LIKE ?
    `, [`${queryMonthSql}%`]);

    // Actual Budget stores transactions in cents.
    // Outflows (expenses) are negative, and Inflows (income) are positive in Actual Budget's DB.
    // To normalize for the dashboard frontend:
    // We divide by -100.0. This makes outflows positive (positive expense) and inflows negative.
    const CENTS_DIVISOR = -100.0;

    const incomeSummary: Record<string, number> = {};
    const expenseSummary: Record<string, number> = {};

    let totalIncome = 0;
    let totalSpent = 0;

    for (const t of rawTransactions) {
      // Divide by -100.0 to convert cents to dollars and align with outflow-positive logic.
      const amount = t.amount / CENTS_DIVISOR;

      // Grouping category matching the frontend transformation logic:
      // If a transfer account name is present, treat as 'Account Transfer'.
      // Otherwise, default to the category name or 'Uncategorized'.
      const categoryName = t.transfer_account_name
        ? 'Account Transfer'
        : (t.category_name || 'Uncategorized');

      const isIncome = Boolean(t.category_is_income);

      if (isIncome) {
        // Income is negative in this representation (e.g. -500), so we flip it to make it positive.
        const positiveIncome = amount * -1;
        incomeSummary[categoryName] = (incomeSummary[categoryName] || 0) + positiveIncome;
        totalIncome += positiveIncome;
      } else {
        // Expense is positive in this representation (e.g. 100), so we sum it directly.
        expenseSummary[categoryName] = (expenseSummary[categoryName] || 0) + amount;
        totalSpent += amount;
      }
    }

    // Convert aggregated records to lists as expected by the Sankey component.
    // Exclude categories that sum to exactly 0 (e.g., matching transfers).
    const income: SpendingCategorySummary[] = Object.entries(incomeSummary)
      .map(([Category_Name, amount]) => ({ Category_Name, amount }))
      .filter(item => Math.abs(item.amount) > 0.001);

    const expenses: SpendingCategorySummary[] = Object.entries(expenseSummary)
      .map(([Category_Name, amount]) => ({ Category_Name, amount }))
      .filter(item => Math.abs(item.amount) > 0.001);

    const netIncome = totalIncome - totalSpent;
    const savingsRate = totalIncome > 0 ? (netIncome / totalIncome) * 100 : 0;

    const transactions = rawTransactions.map(t => {
      const rawDate = String(t.date);
      const dateStr = rawDate.length === 8 
        ? `${rawDate.substring(0, 4)}-${rawDate.substring(4, 6)}-${rawDate.substring(6, 8)}`
        : rawDate;
        
      return {
        id: t.id,
        date: dateStr,
        amount: t.amount / CENTS_DIVISOR,
        Payee_Name: t.transfer_account_name ? `Transfer: ${t.transfer_account_name}` : (t.payee_name || 'Unknown'),
        Category_Name: t.transfer_account_name ? 'Account Transfer' : (t.category_name || 'Uncategorized'),
        is_income: Boolean(t.category_is_income)
      };
    });

    return {
      income,
      expenses,
      totalIncome,
      totalSpent,
      netIncome,
      savingsRate,
      transactions
    };
  }
}
