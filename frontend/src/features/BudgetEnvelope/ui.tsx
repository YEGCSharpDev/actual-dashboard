/**
 * @fileoverview UI component for displaying Budget Envelope Health.
 * Renders the underfunded, overbudget, and underbudget statuses for the selected and future months.
 */

import React, { useEffect, useState } from 'react';
import { fetchEnvelopeHealth } from './api';
import type { EnvelopeHealth } from '../../../../shared/types/BudgetEnvelope';

interface BudgetEnvelopeHealthProps {
  /** The currently selected month in YYYY-MM format */
  selectedMonth: string;
}

/**
 * Renders the Future Envelope Health dashboard section.
 * Fetches data on mount and whenever selectedMonth changes.
 */
export const BudgetEnvelopeHealth: React.FC<BudgetEnvelopeHealthProps> = ({ selectedMonth }) => {
  const [healthData, setHealthData] = useState<EnvelopeHealth[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchEnvelopeHealth(selectedMonth);
        if (isMounted) {
          setHealthData(response.healthData);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Failed to load envelope health');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, [selectedMonth]);

  if (loading) {
    return <div style={{ marginBottom: '2rem' }}>Loading envelope health...</div>;
  }

  if (error) {
    return <div style={{ marginBottom: '2rem', color: 'var(--color-danger)' }}>Error: {error}</div>;
  }

  // Helper to format the YYYYMM string into a readable label (e.g., 'June')
  const formatMonthLabel = (yyyymm: string) => {
    const year = parseInt(yyyymm.substring(0, 4), 10);
    const month = parseInt(yyyymm.substring(4, 6), 10) - 1;
    const date = new Date(year, month, 1);
    return date.toLocaleDateString('en-US', { month: 'long' });
  };

  return (
    <>
      <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: '1.35rem', marginBottom: '1rem' }}>
        Future Envelope Health
      </h2>
      <div className="grid-cols-3" style={{ marginBottom: '2rem' }}>
        {healthData.map((item) => {
          const label = formatMonthLabel(item.month);
          const val = item.underfunded; // Currently focusing on underfunded

          return (
            <div
              className="card metric-card"
              key={item.month}
              style={{ borderColor: val > 0 ? 'var(--color-warning-border)' : 'var(--color-success-border)' }}
            >
              <span className="metric-label">Underfunded ({label})</span>
              <span
                className="metric-value"
                style={{ color: val > 0 ? 'var(--color-warning)' : 'var(--color-success)' }}
              >
                ${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className={`metric-delta ${val > 0 ? 'delta-danger' : 'delta-success'}`}>
                {val > 0 ? 'Action Required' : 'Fully Funded'}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
};
