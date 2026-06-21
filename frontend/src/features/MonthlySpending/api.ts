/**
 * @file frontend/src/features/MonthlySpending/api.ts
 * @description Frontend API client wrapper and React hook for fetching monthly spending analytics.
 * This file serves as the API Layer (Client) in the Vertical Slice Architecture.
 */

import { useState, useEffect, useCallback } from 'react';
import type { MonthlySpendingPayload } from '@shared/types/MonthlySpending';

const API_BASE_URL = '';

/**
 * Sends a GET request to the backend server to fetch aggregated monthly income and expenses.
 * 
 * @param month The month to fetch in YYYY-MM format.
 * @returns A promise resolving to the MonthlySpendingPayload.
 * @throws An error if the server response is not successful.
 */
export async function fetchMonthlySpending(month: string): Promise<MonthlySpendingPayload> {
  const url = `${API_BASE_URL}/api/monthly-spending?month=${encodeURIComponent(month)}`;
  const response = await fetch(url);
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch monthly spending analytics (HTTP ${response.status})`);
  }
  
  return response.json() as Promise<MonthlySpendingPayload>;
}

/**
 * A custom React hook that encapsulates the state management, loading states,
 * and error handling for fetching monthly spending data.
 * 
 * @param month The month to fetch in YYYY-MM format.
 * @returns An object containing the fetched data, loading flag, error message, and a refetch function.
 */
export function useMonthlySpending(month: string) {
  const [data, setData] = useState<MonthlySpendingPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (targetMonth: string) => {
    if (!targetMonth) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const payload = await fetchMonthlySpending(targetMonth);
      setData(payload);
    } catch (err: any) {
      console.error('[MonthlySpending Hook] Fetch error:', err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-fetch automatically whenever the month changes.
  useEffect(() => {
    loadData(month);
  }, [month, loadData]);

  // Explicit refetch method to trigger manual updates (e.g. after database syncs)
  const refetch = useCallback(() => {
    if (month) {
      loadData(month);
    }
  }, [month, loadData]);

  return {
    data,
    loading,
    error,
    refetch
  };
}
