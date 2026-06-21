/**
 * @file frontend/src/features/InvestmentProjections/api.ts
 * @description Client API integration for the Investment Projections feature slice.
 * Handles fetching baseline balances, config, and initial projections from the backend.
 */

import { useState, useEffect } from 'react';
import type { InvestmentProjectionsPayload } from '@shared/types/InvestmentProjections';

const API_BASE_URL = '/api';

/**
 * Fetches the Investment Projections baseline payload.
 * 
 * @returns A promise resolving to the baseline payload.
 */
export const fetchInvestmentProjections = async (): Promise<InvestmentProjectionsPayload> => {
  const response = await fetch(`${API_BASE_URL}/investment-projections/baseline`);
  if (!response.ok) {
    throw new Error('Failed to fetch investment projections data');
  }
  return response.json();
};

/**
 * React hook to fetch and manage Investment Projections baseline state.
 * 
 * @param lastSyncTime Used as a dependency to re-fetch when external sync occurs.
 * @returns An object containing the payload, loading state, and error message.
 */
export function useInvestmentProjections(lastSyncTime: string | null) {
  const [data, setData] = useState<InvestmentProjectionsPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchInvestmentProjections();
        if (mounted) {
          setData(result);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || 'Error loading investment projections');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, [lastSyncTime]);

  return { data, loading, error };
}
