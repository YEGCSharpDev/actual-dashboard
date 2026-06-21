/**
 * @file frontend/src/features/CashflowSankey/api.ts
 * @description Client API integration for the Cashflow Sankey feature slice.
 * Handles fetching layout and geometry payload from the backend.
 */

import { useState, useEffect } from 'react';
import type { CashflowSankeyPayload } from '@shared/types/CashflowSankey';

const API_BASE_URL = 'http://localhost:3000/api';

/**
 * Fetches the computed Cashflow Sankey layout payload.
 * 
 * @param month The requested month in YYYY-MM format.
 * @returns A promise resolving to the layout payload.
 */
export const fetchCashflowSankey = async (month: string): Promise<CashflowSankeyPayload> => {
  const response = await fetch(`${API_BASE_URL}/cashflow-sankey?month=${month}`);
  if (!response.ok) {
    throw new Error('Failed to fetch cashflow sankey data');
  }
  return response.json();
};

/**
 * React hook to fetch and manage Cashflow Sankey state.
 * 
 * @param month The currently selected month.
 * @param lastSyncTime Used as a dependency to re-fetch when external sync occurs.
 * @returns An object containing the payload, loading state, and error message.
 */
export function useCashflowSankey(month: string, lastSyncTime: string | null) {
  const [data, setData] = useState<CashflowSankeyPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchCashflowSankey(month);
        if (mounted) {
          setData(result);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || 'Error loading sankey data');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    if (month) {
      loadData();
    }

    return () => {
      mounted = false;
    };
  }, [month, lastSyncTime]);

  return { data, loading, error };
}
