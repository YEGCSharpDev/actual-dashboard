import type { IDbClient } from '../../infrastructure/db/IDbClient.js';
import type { MonthlySpendingPayload, SpendingCategorySummary } from '@shared/types/MonthlySpending';

import { CENTS_TO_DOLLARS_OUTFLOW_POSITIVE } from '../../../../shared/constants/financial.js';

/**
 * Retrieves aggregated monthly spending and income analytics for a given month.
 * Filters out transactions on off-budget accounts.
 * 
 * @param db The IDbClient to use for querying
 * @param selectedMonth The month to query in YYYY-MM format.
 * @returns A promise resolving to the monthly spending analytics payload.
 */
export async function getMonthlySpending(db: IDbClient, selectedMonth: string): Promise<MonthlySpendingPayload> {
  const queryMonthSql = selectedMonth.replace('-', '');
  
  const rawTransactions = await db.query(`
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

  const incomeSummary: Record<string, number> = {};
  const expenseSummary: Record<string, number> = {};

  let totalIncome = 0;
  let totalSpent = 0;

  for (const t of rawTransactions) {
    const amount = t.amount / CENTS_TO_DOLLARS_OUTFLOW_POSITIVE;

    const categoryName = t.transfer_account_name
      ? 'Account Transfer'
      : (t.category_name || 'Uncategorized');

    const isIncome = Boolean(t.category_is_income);

    if (isIncome) {
      const positiveIncome = amount * -1;
      incomeSummary[categoryName] = (incomeSummary[categoryName] || 0) + positiveIncome;
      totalIncome += positiveIncome;
    } else {
      expenseSummary[categoryName] = (expenseSummary[categoryName] || 0) + amount;
      totalSpent += amount;
    }
  }

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
      amount: t.amount / CENTS_TO_DOLLARS_OUTFLOW_POSITIVE,
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
