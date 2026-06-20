/**
 * @file frontend/src/features/InvestmentProjections/ui.tsx
 * @description UI components for the Investment Projections feature slice.
 * Contains interactive sliders to modify expected return rates and displays live
 * compound interest forecasts for RESP, RRSP, and TFSA.
 */

import { useState, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import { useInvestmentProjections } from './api';
import type { 
  StandardProjectionConfig, 
  TFSAProjectionConfig,
  ProjectionSeries 
} from '@shared/types/InvestmentProjections';

export interface InvestmentProjectionsDashboardProps {
  /** Trigger a refetch if the global sync time updates. */
  lastSyncTime: string | null;
}

/**
 * Computes a standard investment projection on the frontend.
 * 
 * @param balances Current balances mapped by account name.
 * @param config Standard projection configuration.
 * @param customReturnPct The custom return percentage chosen via slider.
 * @returns The computed projection series.
 */
function buildStandardForecast(
  balances: Record<string, number>,
  config: StandardProjectionConfig,
  customReturnPct: number
): ProjectionSeries {
  const currentYear = new Date().getFullYear();
  const forecastData: Record<string, number[]> = {};
  const years: number[] = [];
  const accountsList = Object.keys(balances);
  
  accountsList.forEach(name => forecastData[name] = []);

  for (let yearOffset = 0; yearOffset <= config.horizonYears; yearOffset++) {
    years.push(currentYear + yearOffset);
  }

  let totalCurrent = 0;
  let totalHalfway = 0;
  let totalFinal = 0;
  const halfwayOffset = Math.floor(config.horizonYears / 2);
  const returnRate = customReturnPct / 100.0;

  accountsList.forEach(name => {
    let currentBalance = balances[name];
    totalCurrent += currentBalance;

    for (let yearOffset = 0; yearOffset <= config.horizonYears; yearOffset++) {
      if (yearOffset === halfwayOffset) totalHalfway += currentBalance;
      if (yearOffset === config.horizonYears) totalFinal += currentBalance;

      forecastData[name].push(currentBalance);
      
      // --- MATHEMATICAL GROWTH MODEL (FRONTEND LIVE RECALCULATION) ---
      // Compound Interest Formula (Annual Compounding + Annual Contribution):
      // Balance_{t} = Balance_{t-1} * (1 + r) + C
      // Where:
      // - r is the expected annual return rate from the slider (e.g., 0.08 for 8%)
      // - C is the planned annual contribution
      currentBalance = (currentBalance * (1 + returnRate)) + config.annualContribution;
    }
  });

  return { years, forecastData, totalCurrent, totalHalfway, totalFinal };
}

/**
 * Computes the TFSA projection on the frontend, respecting base and catchup logic.
 * 
 * @param balances Current balances mapped by account name.
 * @param config TFSA-specific configuration.
 * @param baseReturnPct Custom return percentage for the base account.
 * @param catchupReturnPct Custom return percentage for the catch-up account.
 * @returns The computed TFSA projection series.
 */
function buildTFSAForecast(
  balances: Record<string, number>,
  config: TFSAProjectionConfig,
  baseReturnPct: number,
  catchupReturnPct: number
): ProjectionSeries {
  const currentYear = new Date().getFullYear();
  const accountsList = Object.keys(balances);
  const years: number[] = [];
  const forecastData: Record<string, number[]> = {};

  accountsList.forEach(name => forecastData[name] = []);

  for (let yearOffset = 0; yearOffset <= config.horizonYears; yearOffset++) {
    years.push(currentYear + yearOffset);
  }

  let totalCurrent = 0;
  let totalHalfway = 0;
  let totalFinal = 0;
  const halfwayOffset = Math.floor(config.horizonYears / 2);

  const catchupMatch = config.catchup.identifier.toUpperCase();
  const baseAnnualContrib = config.base.monthlyContribution * 12;
  const wsCatchupYearAnnual = config.catchup.catchupYearContribution;
  const wsFutureAnnual = config.totalRoom - baseAnnualContrib;

  accountsList.forEach(name => {
    let currentBalance = balances[name];
    totalCurrent += currentBalance;

    const upperName = name.toUpperCase();
    const catchupWords = catchupMatch.split(/\s+/).filter(w => w && w !== 'TFSA');
    const isCatchup = upperName.includes(catchupMatch) || 
                      upperName.includes("WEALTHSIMPLE") ||
                      (catchupWords.length > 0 && catchupWords.every(word => upperName.includes(word)));
                      
    const rate = isCatchup ? (catchupReturnPct / 100.0) : (baseReturnPct / 100.0);

    for (let yearOffset = 0; yearOffset <= config.horizonYears; yearOffset++) {
      if (yearOffset === halfwayOffset) totalHalfway += currentBalance;
      if (yearOffset === config.horizonYears) totalFinal += currentBalance;

      forecastData[name].push(currentBalance);

      let contrib = baseAnnualContrib;
      if (isCatchup) {
        contrib = yearOffset === 0 ? wsCatchupYearAnnual : wsFutureAnnual;
      }

      // --- MATHEMATICAL GROWTH MODEL (FRONTEND LIVE RECALCULATION) ---
      // Compound Interest Formula for TFSA (Annual Compounding + Dynamic Contribution):
      // Balance_{t} = Balance_{t-1} * (1 + r) + C_{t}
      // Where:
      // - r is the assigned account rate based on the slider (base or catchup)
      // - C_{t} is the dynamic contribution logic for the catchup rules
      currentBalance = (currentBalance * (1 + rate)) + contrib;
    }
  });

  return { years, forecastData, totalCurrent, totalHalfway, totalFinal };
}

/**
 * Main Investment Projections UI Component.
 */
export function InvestmentProjectionsDashboard({ lastSyncTime }: InvestmentProjectionsDashboardProps) {
  const { data, loading, error } = useInvestmentProjections(lastSyncTime);

  // Return rate sliders state
  const [respReturnPct, setRespReturnPct] = useState<number>(0);
  const [rrspReturnPct, setRrspReturnPct] = useState<number>(0);
  const [tfsaBaseReturnPct, setTfsaBaseReturnPct] = useState<number>(0);
  const [tfsaCatchupReturnPct, setTfsaCatchupReturnPct] = useState<number>(0);

  // Tab state
  const [activeInvestTab, setActiveInvestTab] = useState<'RESP' | 'RRSP' | 'TFSA' | null>(null);

  useEffect(() => {
    if (data) {
      if (respReturnPct === 0) {
        setRespReturnPct(data.respConfig.defaultReturnPct);
        setRrspReturnPct(data.rrspConfig.defaultReturnPct);
        setTfsaBaseReturnPct(data.tfsaConfig.base.defaultReturnPct);
        setTfsaCatchupReturnPct(data.tfsaConfig.catchup.defaultReturnPct);
      }
      
      if (!activeInvestTab) {
        const available: ('RESP' | 'RRSP' | 'TFSA')[] = [];
        if (data.hasRESP) available.push('RESP');
        if (data.hasRRSP) available.push('RRSP');
        if (data.hasTFSA) available.push('TFSA');
        if (available.length > 0) {
          setActiveInvestTab(available[0]);
        }
      }
    }
  }, [data, respReturnPct, activeInvestTab]);

  if (loading) return <div style={{ color: 'var(--color-text-secondary)' }}>Loading investment projections...</div>;
  if (error) return <div style={{ color: 'var(--color-danger)' }}>Error loading projections: {error}</div>;
  if (!data || !data.hasInvestments || !activeInvestTab) return null;

  // Compute live projections based on current slider values
  let liveSeries: ProjectionSeries | null = null;
  let horizonYears = 10;

  if (activeInvestTab === 'RESP' && data.hasRESP) {
    horizonYears = data.respConfig.horizonYears;
    liveSeries = buildStandardForecast(data.respBalances, data.respConfig, respReturnPct);
  } else if (activeInvestTab === 'RRSP' && data.hasRRSP) {
    horizonYears = data.rrspConfig.horizonYears;
    liveSeries = buildStandardForecast(data.rrspBalances, data.rrspConfig, rrspReturnPct);
  } else if (activeInvestTab === 'TFSA' && data.hasTFSA) {
    horizonYears = data.tfsaConfig.horizonYears;
    liveSeries = buildTFSAForecast(data.tfsaBalances, data.tfsaConfig, tfsaBaseReturnPct, tfsaCatchupReturnPct);
  }

  if (!liveSeries) return null;

  const accountsList = Object.keys(liveSeries.forecastData);
  const currentYear = new Date().getFullYear();
  const halfwayOffset = Math.floor(horizonYears / 2);

  // Chart preparation
  const colors = ['#6366f1', '#10b981', '#3b82f6', '#f59e0b', '#ec4899'];
  const chartDatasets = accountsList.map((name, idx) => ({
    label: name,
    data: liveSeries!.forecastData[name],
    borderColor: colors[idx % colors.length],
    borderWidth: 3,
    tension: 0.15,
    pointRadius: 4,
    pointHoverRadius: 6,
  }));

  const chartData = {
    labels: liveSeries.years.map(String),
    datasets: chartDatasets
  };

  return (
    <>
      <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: '1.35rem', marginBottom: '1rem' }}>
        Investment Forecasts
      </h2>
      
      {/* Tabs */}
      <div className="tabs-container">
        {([
          data.hasRESP && 'RESP',
          data.hasRRSP && 'RRSP',
          data.hasTFSA && 'TFSA'
        ].filter(Boolean) as ('RESP' | 'RRSP' | 'TFSA')[]).map(tab => (
          <button
            key={tab}
            className={`tab-button ${activeInvestTab === tab ? 'active' : ''}`}
            onClick={() => setActiveInvestTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* Slider Controls */}
        <div className="grid-cols-2" style={{ marginBottom: 0 }}>
          {activeInvestTab === 'RESP' && (
            <div className="slider-group">
              <div className="slider-header">
                <span>RESP Expected YoY Return</span>
                <span className="slider-value">{respReturnPct}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="15"
                step="0.5"
                value={respReturnPct}
                onChange={e => setRespReturnPct(Number(e.target.value))}
              />
            </div>
          )}
          {activeInvestTab === 'RRSP' && (
            <div className="slider-group">
              <div className="slider-header">
                <span>RRSP Expected YoY Return</span>
                <span className="slider-value">{rrspReturnPct}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="15"
                step="0.5"
                value={rrspReturnPct}
                onChange={e => setRrspReturnPct(Number(e.target.value))}
              />
            </div>
          )}
          {activeInvestTab === 'TFSA' && (
            <>
              <div className="slider-group">
                <div className="slider-header">
                  <span>Base TFSA ({data.tfsaConfig.base.identifier}) YoY Return</span>
                  <span className="slider-value">{tfsaBaseReturnPct}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="15"
                  step="0.5"
                  value={tfsaBaseReturnPct}
                  onChange={e => setTfsaBaseReturnPct(Number(e.target.value))}
                />
              </div>
              <div className="slider-group">
                <div className="slider-header">
                  <span>Catch-up TFSA ({data.tfsaConfig.catchup.identifier}) YoY Return</span>
                  <span className="slider-value">{tfsaCatchupReturnPct}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="15"
                  step="0.5"
                  value={tfsaCatchupReturnPct}
                  onChange={e => setTfsaCatchupReturnPct(Number(e.target.value))}
                />
              </div>
            </>
          )}
        </div>

        {/* Projection Metrics */}
        {accountsList.length === 0 ? (
          <div className="card" style={{ color: 'var(--color-text-secondary)', textAlign: 'center' }}>
            No accounts found for this category.
          </div>
        ) : (
          <>
            <div className="grid-cols-3" style={{ marginBottom: '1rem' }}>
              <div className="card metric-card">
                <span className="metric-label">Current Total</span>
                <span className="metric-value">
                  ${liveSeries.totalCurrent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="card metric-card">
                <span className="metric-label">Halfway Projection ({currentYear + halfwayOffset})</span>
                <span className="metric-value">
                  ${Math.round(liveSeries.totalHalfway).toLocaleString()}
                </span>
              </div>
              <div className="card metric-card">
                <span className="metric-label">Final Projection ({currentYear + horizonYears})</span>
                <span className="metric-value">
                  ${Math.round(liveSeries.totalFinal).toLocaleString()}
                </span>
              </div>
            </div>

            {/* Projections Chart */}
            <div className="card" style={{ height: '380px', position: 'relative' }}>
              <Line
                data={chartData}
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
          </>
        )}
      </div>
    </>
  );
}
