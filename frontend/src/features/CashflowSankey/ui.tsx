/**
 * @file frontend/src/features/CashflowSankey/ui.tsx
 * @description React UI components for the Cashflow Sankey visualization slice.
 * Handles fetching layout data via the api and rendering the responsive SVG.
 */

import React from 'react';
import { useCashflowSankey } from './api';

export interface MonthlyCashflowSankeyProps {
  selectedMonth: string;
  lastSyncTime: string | null;
}

/**
 * Renders the pure SVG Sankey diagram using pre-calculated layout data from the backend.
 * Uses SVG viewBox for native, responsive scaling without React resize observers.
 */
export const MonthlyCashflowSankey: React.FC<MonthlyCashflowSankeyProps> = ({ selectedMonth, lastSyncTime }) => {
  const { data, loading, error } = useCashflowSankey(selectedMonth, lastSyncTime);

  if (loading && !data) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '4rem 0', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ width: '24px', height: '24px', border: '2px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>Loading cashflow chart...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card" style={{ borderColor: 'var(--color-danger-border)', padding: '1.5rem', textAlign: 'center', marginBottom: '2rem' }}>
        <p style={{ color: 'var(--color-danger)', fontWeight: 600, fontSize: '0.9rem' }}>Failed to load Cashflow Chart</p>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>{error}</p>
      </div>
    );
  }

  const { nodes, links, width, height } = data;

  if (nodes.length === 0 && links.length === 0) {
    return <div style={{ color: 'var(--color-text-secondary)', textAlign: 'center', padding: '2rem' }}>No data available for flow chart.</div>;
  }

  return (
    <>
      <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: '1.35rem', marginBottom: '1rem' }}>Monthly Cashflow</h2>
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div style={{ width: '100%' }}>
          <div style={{ position: 'relative', width: '100%', overflowX: 'auto' }}>
            {/* The SVG element uses viewBox corresponding to the coordinate system created by the backend.
                This provides 100% responsive fluid scaling natively in the browser. */}
            <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style={{ display: 'block', margin: '0 auto', width: '100%', height: 'auto', minWidth: '900px' }}>
              
              {/* Draw Links (Bezier Paths) in a background group so they render behind nodes */}
              <g>
                {links.map((link, idx) => (
                  <path
                    key={idx}
                    d={link.d} // Pre-calculated M x1 y1 C cx1 cy1, cx2 cy2, x2 y2
                    fill="none"
                    stroke={link.color}
                    strokeWidth={link.strokeWidth}
                    style={{
                      transition: 'stroke 0.2s',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.stroke = link.color.replace('0.25', '0.5').replace('0.2', '0.45');
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.stroke = link.color;
                    }}
                  >
                    <title>{link.tooltip}</title>
                  </path>
                ))}
              </g>

              {/* Draw Nodes (Rectangles) and Text Labels */}
              <g>
                {nodes.map(node => (
                  <g key={node.id}>
                    {/* Node rectangle calculated dynamically based on total amount vs height scale */}
                    <rect
                      x={node.x}
                      y={node.y}
                      width={node.w}
                      height={node.h}
                      fill={node.color}
                      rx={2}
                      style={{ cursor: 'pointer' }}
                    >
                      <title>{`${node.label}: $${node.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</title>
                    </rect>
                    
                    {/* Primary Node Label (Category Name) */}
                    {/* Text anchoring logic pushes left-side text to start and right-side text to end */}
                    <text
                      x={node.x + (node.x > width / 2 ? node.w + 6 : -6)}
                      y={node.y + node.h / 2}
                      fill="var(--color-text-primary)"
                      fontSize="11px"
                      fontWeight="600"
                      textAnchor={node.x > width / 2 ? 'start' : 'end'}
                      dominantBaseline="central"
                      style={{
                        pointerEvents: 'none',
                        textShadow: '0 1px 3px rgba(0,0,0,0.8)'
                      }}
                    >
                      {node.label}
                    </text>
                    
                    {/* Secondary Node Label (Amount) shown only if node is tall enough */}
                    {node.h > 12 && (
                      <text
                        x={node.x + (node.x > width / 2 ? node.w + 6 : -6)}
                        y={node.y + node.h / 2 + 12}
                        fill="var(--color-text-secondary)"
                        fontSize="10px"
                        textAnchor={node.x > width / 2 ? 'start' : 'end'}
                        dominantBaseline="central"
                        style={{ pointerEvents: 'none' }}
                      >
                        ${Math.round(node.amount).toLocaleString()}
                      </text>
                    )}
                  </g>
                ))}
              </g>
            </svg>
          </div>
        </div>
      </div>
    </>
  );
};
