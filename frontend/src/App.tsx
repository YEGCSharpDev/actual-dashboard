/**
 * @file frontend/src/App.tsx
 * @description Main application entry point for the Actual Budget Dashboard.
 * Serves as the primary layout wrapper and central data fetcher for monolithic features
 * while rendering isolated Vertical Slice components.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

import { MonthlySpendingOverview } from './features/MonthlySpending/ui';
import { MonthlyCashflowSankey } from './features/CashflowSankey/ui';
import { BudgetEnvelopeHealth } from './features/BudgetEnvelope/ui';
import { TFSAContributionsYTD } from './features/TFSAContributions/ui';
import { InvestmentProjectionsDashboard } from './features/InvestmentProjections/ui';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// Set high-contrast global defaults for Chart.js in dark theme
ChartJS.defaults.color = '#cbd5e1';
ChartJS.defaults.font.family = "'Plus Jakarta Sans', -apple-system, sans-serif";
ChartJS.defaults.plugins.legend.labels.color = '#cbd5e1';
ChartJS.defaults.scale.ticks.color = '#cbd5e1';
ChartJS.defaults.scale.grid.color = 'rgba(255, 255, 255, 0.05)';




// Interfaces for API response
interface Account {
  id: string;
  name: string;
  offbudget: boolean;
  closed: boolean;
  balance_current: number | null;
}

interface Transaction {
  id: string;
  date: string;
  amount: number; // Outflow positive, Inflow negative
  amount_dollars: number; // Inflow positive, Outflow negative
  account: string;
  account_name: string;
  account_offbudget: boolean;
  Payee_Name: string;
  category: string;
  Category_Name: string;
  is_income: boolean;
  Group_Name: string;
}

interface AppConfig {
  categories: {
    tfsa_tracking: string[];
    budget_tracking: string[];
  };
  resp: {
    identifier: string;
    horizon_years: number;
    default_return_pct: number;
    monthly_contribution: number;
  };
  rrsp: {
    identifier: string;
    horizon_years: number;
    default_return_pct: number;
    annual_contribution: number;
  };
  tfsa: {
    horizon_years: number;
    ytd_limit: number;
    total_room: number;
    base: {
      identifier: string;
      default_return_pct: number;
      monthly_contribution: number;
    };
    catchup: {
      identifier: string;
      default_return_pct: number;
      catchup_year_contribution: number;
    };
  };
  hasInvestments: boolean;
  hasRESP: boolean;
  hasRRSP: boolean;
  hasTFSA: boolean;
}

interface DashboardData {
  accounts: Account[];
  transactions: Transaction[];
  budgets: Record<string, number>;
  config: AppConfig;
  error: string | null;
}

const API_BASE_URL = import.meta.env.DEV ? 'http://localhost:3000' : '';

export default function App() {
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [monthOptions, setMonthOptions] = useState<string[]>([]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<{ isSyncing: boolean; lastSyncTime: string | null; syncError: string | null } | null>(null);

  // Page selector state
  const [activePage, setActivePage] = useState<'dashboard' | 'investments'>('dashboard');

  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/status`);
      const status = await res.json();
      setSyncStatus(status);
    } catch (e) {
      console.error("Failed to fetch sync status", e);
    }
  }, []);

  const loadData = useCallback(async (month: string) => {
    if (!month) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/data?month=${month}`);
      const json = await res.json();
      if (json.error) {
        setError(json.error);
      } else {
        setData(json);
      }
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load initial configurations and set initial month
  useEffect(() => {
    const init = async () => {
      // Setup default month options (current year and previous year months)
      const now = new Date();
      const options: string[] = [];
      for (let i = 0; i < 24; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        options.push(`${y}-${m}`);
      }
      setMonthOptions(options);
      setSelectedMonth(options[0]); // default to current month
      
      await fetchSyncStatus();
    };
    init();
  }, [fetchSyncStatus]);

  // Load data when selected month changes
  useEffect(() => {
    if (selectedMonth) {
      loadData(selectedMonth);
    }
  }, [selectedMonth, loadData]);

  // Poll sync status when syncing
  useEffect(() => {
    let interval: any;
    if (syncStatus?.isSyncing) {
      interval = setInterval(fetchSyncStatus, 2000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [syncStatus?.isSyncing, fetchSyncStatus]);

  const handleSync = async () => {
    if (syncStatus?.isSyncing) return;
    setSyncStatus(prev => prev ? { ...prev, isSyncing: true } : { isSyncing: true, lastSyncTime: null, syncError: null });
    try {
      await fetch(`${API_BASE_URL}/api/sync`, { method: 'POST' });
      await fetchSyncStatus();
      if (selectedMonth) {
        await loadData(selectedMonth);
      }
    } catch (e: any) {
      console.error(e);
      await fetchSyncStatus();
    }
  };

  if (loading && !data) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ width: '40px', height: '40px', border: '3px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <div style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Fetching data from Actual API...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-container" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
        <div className="card" style={{ maxWidth: '600px', margin: '0 auto', borderColor: 'var(--color-danger-border)' }}>
          <h2 style={{ color: 'var(--color-danger)', marginBottom: '1rem', fontFamily: 'var(--font-heading)' }}>Failed to load Dashboard</h2>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: '2rem' }}>{error}</p>
          <button className="sync-button" style={{ margin: '0 auto' }} onClick={() => loadData(selectedMonth)}>Retry Connection</button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { transactions, budgets, config } = data;

  // Filter transactions for selected month
  const dfFiltered = transactions.filter(t => t.date.substring(0, 7) === selectedMonth && !t.account_offbudget);

  // Split income/expense (dfExpenses is used in Envelope Health & Transaction Log)
  const dfExpenses = dfFiltered.filter(t => !t.is_income);





  return (
    <div className="app-container">
      {/* Header & Sync Status */}
      <header className="header">
        <div>
          <h1 className="title">Actual Budget Dashboard</h1>
          {syncStatus && (
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>
              {syncStatus.isSyncing ? (
                <span style={{ color: 'var(--color-warning)', fontWeight: 600 }}>Syncing with Actual...</span>
              ) : syncStatus.syncError ? (
                <span style={{ color: 'var(--color-danger)' }}>Sync failed: {syncStatus.syncError}</span>
              ) : (
                <span>Last Sync: {syncStatus.lastSyncTime ? new Date(syncStatus.lastSyncTime).toLocaleTimeString() : 'Never'}</span>
              )}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <select
            className="sidebar-select"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
          >
            {monthOptions.map(opt => (
              <option key={opt} value={opt}>
                {new Date(opt + '-02').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </option>
            ))}
          </select>

          <button
            className="sync-button"
            onClick={handleSync}
            disabled={syncStatus?.isSyncing}
          >
            {syncStatus?.isSyncing ? (
              <>
                <div style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.2)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                Syncing...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                Sync API
              </>
            )}
          </button>
        </div>
      </header>

      {/* Page Selector Tabs */}
      {config.hasInvestments && (
        <div className="tabs-container" style={{ marginBottom: '2rem' }}>
          <button
            className={`tab-button ${activePage === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActivePage('dashboard')}
          >
            Dashboard
          </button>
          <button
            className={`tab-button ${activePage === 'investments' ? 'active' : ''}`}
            onClick={() => setActivePage('investments')}
          >
            Investments
          </button>
        </div>
      )}

      {activePage === 'dashboard' && (
        <>
          <MonthlySpendingOverview selectedMonth={selectedMonth} lastSyncTime={syncStatus?.lastSyncTime || null} />

          {/* 3. Envelope Health Checks */}
          <BudgetEnvelopeHealth selectedMonth={selectedMonth} />

          {/* 4. Key Category Tracking */}
          {config.categories.budget_tracking.length > 0 && (
            <>
              <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: '1.35rem', marginBottom: '1rem' }}>Key Category Tracking</h2>
              <div className="card" style={{ marginBottom: '2rem' }}>
                {config.categories.budget_tracking.map(cat => {
                  const budgeted = budgets[cat] || 0;
                  const spent = dfExpenses.filter(t => t.Category_Name === cat).reduce((acc, t) => acc + t.amount, 0);
                  const left = budgeted - spent;
                  
                  const pct = budgeted > 0 ? (spent / budgeted) * 100 : (spent > 0 ? 100 : 0);
                  const visPct = Math.min(pct, 100.0);
                  
                  let barColor = 'var(--color-success)';
                  let barBg = 'var(--color-success-bg)';
                  let borderStyle = 'rgba(16, 185, 129, 0.15)';
                  if (pct >= 90) {
                    barColor = 'var(--color-danger)';
                    barBg = 'var(--color-danger-bg)';
                    borderStyle = 'rgba(244, 63, 94, 0.15)';
                  } else if (pct >= 75) {
                    barColor = 'var(--color-warning)';
                    barBg = 'var(--color-warning-bg)';
                    borderStyle = 'rgba(245, 158, 11, 0.15)';
                  }

                  return (
                    <div className="cat-row" key={cat}>
                      <div className="cat-row-header">
                        <span>{cat}</span>
                        <span style={{ color: barColor }}>
                          {left >= 0 ? `$${left.toLocaleString(undefined, { minimumFractionDigits: 2 })} left` : `$${Math.abs(left).toLocaleString(undefined, { minimumFractionDigits: 2 })} over!`}
                        </span>
                      </div>
                      <div className="cat-row-track" style={{ backgroundColor: barBg, borderColor: borderStyle }}>
                        <div className="cat-row-fill" style={{ width: `${visPct}%`, backgroundColor: barColor }} />
                        <div className="cat-row-labels">
                          <span>{pct.toFixed(1)}%</span>
                          <span>${spent.toLocaleString(undefined, { minimumFractionDigits: 2 })} / ${Math.round(budgeted).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <MonthlyCashflowSankey selectedMonth={selectedMonth} lastSyncTime={syncStatus?.lastSyncTime || null} />

          {/* 6. Transaction Log */}
          <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: '1.35rem', marginBottom: '1rem' }}>Transaction Log</h2>
          <div className="card" style={{ marginBottom: '2rem', padding: 0, overflow: 'hidden' }}>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Payee</th>
                    <th>Category</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {dfExpenses.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: 'center', color: 'var(--color-text-secondary)', padding: '2rem' }}>No expense transactions recorded this month.</td>
                    </tr>
                  ) : (
                    [...dfExpenses]
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map(t => (
                        <tr key={t.id}>
                          <td style={{ color: 'var(--color-text-secondary)' }}>{t.date}</td>
                          <td style={{ fontWeight: 600 }}>{t.Payee_Name}</td>
                          <td>
                            <span style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                              {t.Category_Name}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--color-danger)' }}>
                            ${t.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activePage === 'investments' && (
        <>
          {/* 7. TFSA Contributions YTD */}
          <TFSAContributionsYTD lastSyncTime={syncStatus?.lastSyncTime || null} />

          {/* 8. Investment Forecasts */}
          <InvestmentProjectionsDashboard lastSyncTime={syncStatus?.lastSyncTime || null} />
        </>
      )}
    </div>
  );
}
