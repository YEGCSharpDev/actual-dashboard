/**
 * @file frontend/src/features/TFSAContributions/ui.tsx
 * @description UI components for the TFSA Contributions feature slice.
 * Displays YTD progress, category breakdown, and a velocity chart.
 */

import { Line } from 'react-chartjs-2';
import { useTfsaContributions } from './api';

export interface TFSAContributionsYTDProps {
  /** Re-fetch data if this timestamp changes. */
  lastSyncTime: string | null;
}

/**
 * Renders the TFSA Contributions YTD dashboard.
 * 
 * @param props The component properties.
 */
export function TFSAContributionsYTD({ lastSyncTime }: TFSAContributionsYTDProps) {
  const { data, loading, error } = useTfsaContributions(lastSyncTime);

  if (loading) {
    return <div style={{ color: 'var(--color-text-secondary)' }}>Loading TFSA contributions...</div>;
  }

  if (error) {
    return <div style={{ color: 'var(--color-danger)' }}>Failed to load TFSA contributions: {error}</div>;
  }

  if (!data || !data.hasTFSA || data.categories.length === 0) {
    return null; // Not configured or no data
  }

  return (
    <>
      <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: '1.35rem', marginBottom: '1rem' }}>
        TFSA Contributions (YTD)
      </h2>
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div className="grid-cols-4" style={{ marginBottom: '1.5rem' }}>
          {data.categories.map(cat => (
            <div className="card metric-card" key={cat.name} style={{ background: 'rgba(255,255,255,0.02)' }}>
              <span className="metric-label">{cat.name}</span>
              <span className="metric-value" style={{ fontSize: '1.4rem' }}>
                ${cat.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          ))}
          <div className="card metric-card" style={{ background: 'var(--color-success-bg)', borderColor: 'var(--color-success-border)' }}>
            <span className="metric-label" style={{ color: 'var(--color-success)' }}>Yearly Room Contribution</span>
            <span className="metric-value" style={{ fontSize: '1.4rem', color: 'var(--color-success)' }}>
              ${data.ytdTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
            <span className="metric-delta delta-success">
              {data.ytdLimit > 0 
                ? `$${data.ytdTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} of $${data.ytdLimit.toLocaleString(undefined, { minimumFractionDigits: 2 })} (${(data.progressPct * 100).toFixed(1)}%)` 
                : ''}
            </span>
          </div>
          <div className="card metric-card" style={{ background: 'var(--color-success-bg)', borderColor: 'var(--color-success-border)' }}>
            <span className="metric-label" style={{ color: 'var(--color-success)' }}>Total Room</span>
            <span className="metric-value" style={{ fontSize: '1.4rem', color: 'var(--color-success)' }}>
              ${data.totalRoom.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </span>
            <span className="metric-delta delta-success">
              {data.totalRoom > 0 
                ? `$${data.ytdTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} of $${data.totalRoom.toLocaleString(undefined, { minimumFractionDigits: 2 })} (${(data.ytdTotal / data.totalRoom * 100).toFixed(1)}%)` 
                : ''}
            </span>
          </div>
        </div>

        {/* TFSA Limit Progress Bar */}
        <div className="progress-bar-wrapper" style={{ marginBottom: '2rem' }}>
          <div className="progress-bar-header" style={{ color: 'var(--color-success)' }}>
            <span>Remaining Room</span>
            <span>Limit: ${data.ytdLimit.toLocaleString()}</span>
          </div>
          <div className="progress-bar-track" style={{ borderColor: 'var(--color-success-border)', backgroundColor: 'rgba(16, 185, 129, 0.05)' }}>
            <div className="progress-bar-fill" style={{ width: `${data.progressPct * 100}%`, backgroundColor: 'var(--color-success)' }}>
              <span className="progress-bar-amount">
                ${data.ytdTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '0.4rem', fontWeight: 600 }}>
            ${data.remainingLimit.toLocaleString(undefined, { minimumFractionDigits: 2 })} remaining of ${data.ytdLimit.toLocaleString()} available room
          </p>
        </div>

        {/* YTD Cumulative Line Chart */}
        {data.velocityChart && (
          <div>
            <h3 style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem', fontWeight: 700 }}>
              Contribution Velocity
            </h3>
            <div style={{ height: '300px', position: 'relative' }}>
              <Line
                data={data.velocityChart as any}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: 'bottom',
                      labels: { color: '#cbd5e1', font: { family: "'Plus Jakarta Sans', -apple-system, sans-serif" } }
                    },
                    tooltip: {
                      callbacks: {
                        label: (context) => `${context.dataset.label}: $${Math.round(context.raw as number).toLocaleString()}`
                      }
                    }
                  },
                  scales: {
                    x: {
                      grid: { color: 'rgba(255, 255, 255, 0.05)' },
                      ticks: { color: '#cbd5e1', font: { family: "'Plus Jakarta Sans', -apple-system, sans-serif" } }
                    },
                    y: {
                      grid: { color: 'rgba(255, 255, 255, 0.05)' },
                      ticks: {
                        color: '#cbd5e1',
                        font: { family: "'Plus Jakarta Sans', -apple-system, sans-serif" },
                        callback: (val) => `$${Number(val).toLocaleString()}`
                      }
                    }
                  }
                }}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
