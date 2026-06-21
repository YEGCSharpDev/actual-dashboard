/**
 * @fileoverview Defines shared types for Budget Envelope health features.
 * Used by both backend and frontend layers to ensure consistent data structures.
 */

/**
 * Represents the health of a budget envelope for a specific month.
 * Provides data on underfunded amounts (budget goal not met) and potentially
 * underbudget/overbudget metrics (spending vs budget).
 */
export interface EnvelopeHealth {
  /** The string representation of the month (e.g., '202406') */
  month: string;
  /** The total amount underfunded (budget goal not met) in decimal dollars */
  underfunded: number;
  /** The total amount overbudget (spending exceeded budget) in decimal dollars */
  overbudget: number;
  /** The total amount underbudget (budget not yet fully spent) in decimal dollars */
  underbudget: number;
}

/**
 * Response payload for the Budget Envelope health check endpoint.
 */
export interface BudgetEnvelopeHealthResponse {
  /** Array of health data across multiple months (usually current and future) */
  healthData: EnvelopeHealth[];
}
