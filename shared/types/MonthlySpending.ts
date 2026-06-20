/**
 * @file shared/types/MonthlySpending.ts
 * @description Shared type definitions for the Monthly Spending Analytics feature slice.
 * This file acts as the single source of truth for the data contracts exchanged
 * between the backend server and frontend client.
 */

/**
 * Represents the aggregated financial totals for a specific month.
 * It contains positive numeric summaries of income, expenses, and cashflow details.
 */
export interface SpendingCategorySummary {
  /** The human-readable name of the budget category */
  Category_Name: string;
  /** The total aggregated transaction amount in dollars */
  amount: number;
}

/**
 * Payload interface returned by the Monthly Spending endpoint.
 * Groups categorized aggregates of income and expense flows.
 */
export interface MonthlySpendingPayload {
  /** List of transactions for the month */
  transactions?: any[];
  /** Aggregated income transactions grouped by category */
  income: SpendingCategorySummary[];
  /** Aggregated expense transactions grouped by category */
  expenses: SpendingCategorySummary[];
  /** Total aggregated income in dollars (sum of all income categories) */
  totalIncome: number;
  /** Total aggregated expenses in dollars (sum of all expense categories) */
  totalSpent: number;
  /** Net income flow in dollars (totalIncome - totalSpent) */
  netIncome: number;
  /** The savings rate percentage computed as (netIncome / totalIncome) * 100 */
  savingsRate: number;
}
