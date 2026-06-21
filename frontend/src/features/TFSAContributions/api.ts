/**
 * @file frontend/src/features/TFSAContributions/api.ts
 * @description Client API integration for the TFSA Contributions feature slice.
 * Handles fetching YTD contribution data and velocity charts from the backend.
 */

import { useState, useEffect } from 'react';
import type { TFSAYearToDateResponse } from '@shared/types/TFSAContributions';

const API_BASE_URL = '/api';

/**
 * Fetches the YTD TFSA Contributions payload.
 * 
 * @returns A promise resolving to the YTD payload.
 */
export const fetchTfsaContributions = async (): Promise<TFSAYearToDateResponse> => {
  const response = await fetch(`${API_BASE_URL}/tfsa-contributions/ytd`);
  if (!response.ok) {
    throw new Error('Failed to fetch TFSA contributions data');
  }
  return response.json();
};

/**
 * React hook to fetch and manage TFSA Contributions state.
 * 
 * @param lastSyncTime Used as a dependency to re-fetch when external sync occurs.
 * @returns An object containing the payload, loading state, and error message.
 */
export function useTfsaContributions(lastSyncTime: string | null) {
  const [data, setData] = useState<TFSAYearToDateResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchTfsaContributions();
        if (mounted) {
          setData(result);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || 'Error loading TFSA data');
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
