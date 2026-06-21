/**
 * @fileoverview Frontend API client for Budget Envelope Health.
 * Provides hooks and functions to securely fetch envelope health data from the backend.
 */

import type { BudgetEnvelopeHealthResponse } from '../../../../shared/types/BudgetEnvelope';

const API_BASE_URL = '';

/**
 * Fetches the budget envelope health data for a given month.
 * 
 * @param selectedMonth - The month to fetch data for (YYYY-MM).
 * @returns A promise resolving to the BudgetEnvelopeHealthResponse payload.
 */
export async function fetchEnvelopeHealth(selectedMonth: string): Promise<BudgetEnvelopeHealthResponse> {
  const response = await fetch(`${API_BASE_URL}/api/budget-envelope/health?month=${encodeURIComponent(selectedMonth)}`);
  
  if (!response.ok) {
    let errorMsg = 'Failed to fetch envelope health';
    try {
      const errorData = await response.json();
      if (errorData.error) errorMsg = errorData.error;
    } catch (e) {
      // Ignore parse error
    }
    throw new Error(errorMsg);
  }

  return response.json();
}
