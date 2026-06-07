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
import type { ChartData } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Sankey } from './Sankey';

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


// Math expression parser
function parseMathInput(exprStr: string): number {
  if (!exprStr || !exprStr.trim()) return 0;
  
  const clean = exprStr.replace(/\s+/g, '');
  if (!/^[0-9+\-*/().]+$/.test(clean)) {
    return 0;
  }

  try {
    return evaluateSimpleExpression(clean);
  } catch (e) {
    return 0;
  }
}

function evaluateSimpleExpression(expr: string): number {
  const tokens: string[] = [];
  let numAccum = '';
  
  for (let i = 0; i < expr.length; i++) {
    const char = expr[i];
    if (/[0-9.]/.test(char)) {
      numAccum += char;
    } else {
      if (numAccum) {
        tokens.push(numAccum);
        numAccum = '';
      }
      tokens.push(char);
    }
  }
  if (numAccum) {
    tokens.push(numAccum);
  }

  const parseNoParens = (toks: string[]): number => {
    const intermediate: (number | string)[] = [];
    let i = 0;
    while (i < toks.length) {
      const tok = toks[i];
      if (tok === '*' || tok === '/') {
        const left = Number(intermediate.pop());
        const right = Number(toks[i + 1]);
        if (tok === '*') {
          intermediate.push(left * right);
        } else {
          intermediate.push(left / right);
        }
        i += 2;
      } else {
        intermediate.push(isNaN(Number(tok)) ? tok : Number(tok));
        i++;
      }
    }

    if (intermediate.length === 0) return 0;
    let res = Number(intermediate[0]);
    let j = 1;
    while (j < intermediate.length) {
      const op = intermediate[j];
      const val = Number(intermediate[j + 1]);
      if (op === '+') {
        res += val;
      } else if (op === '-') {
        res -= val;
      }
      j += 2;
    }
    return res;
  };

  let hasParens = tokens.includes('(');
  let limit = 100;
  while (hasParens && limit > 0) {
    limit--;
    let openIdx = -1;
    let closeIdx = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === '(') {
        openIdx = i;
      } else if (tokens[i] === ')') {
        closeIdx = i;
        break;
      }
    }
    if (openIdx !== -1 && closeIdx !== -1) {
      const subExpression = tokens.slice(openIdx + 1, closeIdx);
      const val = parseNoParens(subExpression);
      tokens.splice(openIdx, closeIdx - openIdx + 1, val.toString());
    } else {
      break;
    }
    hasParens = tokens.includes('(');
  }

  return parseNoParens(tokens);
}

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
    annual_room: number;
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
}

interface DashboardData {
  accounts: Account[];
  transactions: Transaction[];
  budgets: Record<string, number>;
  underbudget: Record<string, number>;
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

  // User input states
  const [addInc, setAddInc] = useState<string>('0');
  const [addExp, setAddExp] = useState<string>('0');
  
  // Return rate sliders
  const [respReturnPct, setRespReturnPct] = useState<number>(0);
  const [rrspReturnPct, setRrspReturnPct] = useState<number>(0);
  const [tfsaBaseReturnPct, setTfsaBaseReturnPct] = useState<number>(0);
  const [tfsaWsReturnPct, setTfsaWsReturnPct] = useState<number>(0);
  
  // Investment tab state
  const [activeInvestTab, setActiveInvestTab] = useState<'RESP' | 'RRSP' | 'TFSA'>('RESP');
  
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
        
        // Initialize return pct states from config if they haven't been touched
        if (respReturnPct === 0 && json.config) {
          setRespReturnPct(json.config.resp.default_return_pct);
          setRrspReturnPct(json.config.rrsp.default_return_pct);
          setTfsaBaseReturnPct(json.config.tfsa.base.default_return_pct);
          setTfsaWsReturnPct(json.config.tfsa.catchup.default_return_pct);
        }
      }
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [respReturnPct]);

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

  const { transactions, accounts, budgets, underbudget, config } = data;

  // Filter transactions for selected month
  const dfFiltered = transactions.filter(t => t.date.substring(0, 7) === selectedMonth);

  // Split income/expense
  const dfIncome = dfFiltered.filter(t => t.is_income);
  const dfExpenses = dfFiltered.filter(t => !t.is_income);

  // Totals
  // Income amounts are negative in database representation of outflows, so we sum them and flip sign
  const totalIncome = dfIncome.reduce((acc, t) => acc + (t.amount * -1), 0);
  const totalSpent = dfExpenses.reduce((acc, t) => acc + t.amount, 0);
  const netIncome = totalIncome - totalSpent;

  // Expected values
  const expectedIncome = totalIncome + parseMathInput(addInc);
  const expectedExpenses = totalSpent + parseMathInput(addExp);
  const forecastNet = expectedIncome - expectedExpenses;

  // Savings rates
  const savingsRate = totalIncome > 0 ? (netIncome / totalIncome) * 100 : 0;
  const expectedSavingsRate = expectedIncome > 0 ? (forecastNet / expectedIncome) * 100 : 0;

  // Progress bar percentages
  const maxExpected = Math.max(expectedIncome, expectedExpenses, 1.0);
  const incPct = Math.min((totalIncome / maxExpected) * 100, 100.0);
  const expPct = Math.min((totalSpent / maxExpected) * 100, 100.0);

  // Future Envelope months mapping
  const targetMonthsArr: { label: string; key: string }[] = [];
  const dateObj = new Date(selectedMonth + '-02');
  for (let i = 0; i < 3; i++) {
    const m = new Date(dateObj.getFullYear(), dateObj.getMonth() + i, 1);
    const label = m.toLocaleString('en-US', { month: 'short', year: 'numeric' });
    const key = `${m.getFullYear()}${String(m.getMonth() + 1).padStart(2, '0')}`;
    targetMonthsArr.push({ label, key });
  }

  // Helper to get investment accounts dictionary
  const getInvestmentBalances = (type: 'RESP' | 'RRSP' | 'TFSA') => {
    const balances: Record<string, number> = {};
    const respId = config.resp.identifier.toUpperCase();
    const rrspId = config.rrsp.identifier.toUpperCase();
    const tfsaId = config.tfsa.base.identifier.toUpperCase();
    const tfsaCatchupId = config.tfsa.catchup.identifier.toUpperCase();

    accounts.forEach(acc => {
      if (acc.closed || !acc.offbudget) return;
      const name = acc.name.toUpperCase();
      let match = false;
      if (type === 'RESP' && name.includes(respId)) match = true;
      if (type === 'RRSP' && name.includes(rrspId)) match = true;
      if (type === 'TFSA') {
        if (name.includes('TFSA') || name.includes(tfsaId) || name.includes(tfsaCatchupId)) {
          match = true;
        }
      }

      if (match) {
        balances[acc.name] = (acc.balance_current || 0) / 100.0;
      }
    });
    return balances;
  };

  // Build forecast data
  const buildForecastSeries = (
    accountDict: Record<string, number>,
    yearsToTrack: number,
    returnRate: number,
    annualContribution: number
  ) => {
    const currentYear = new Date().getFullYear();
    const forecastData: Record<string, number[]> = {};
    const years: number[] = [];
    const accountsList = Object.keys(accountDict);
    
    // Initialize array for each account
    accountsList.forEach(name => {
      forecastData[name] = [];
    });

    for (let yearOffset = 0; yearOffset <= yearsToTrack; yearOffset++) {
      years.push(currentYear + yearOffset);
    }

    let totalCurrent = 0;
    let totalHalfway = 0;
    let totalFinal = 0;
    const halfwayOffset = Math.floor(yearsToTrack / 2);

    accountsList.forEach(name => {
      let currentBalance = accountDict[name];
      totalCurrent += currentBalance;

      for (let yearOffset = 0; yearOffset <= yearsToTrack; yearOffset++) {
        if (yearOffset === halfwayOffset) totalHalfway += currentBalance;
        if (yearOffset === yearsToTrack) totalFinal += currentBalance;

        forecastData[name].push(currentBalance);
        
        // Compound interest and add contribution
        currentBalance = (currentBalance * (1 + returnRate)) + annualContribution;
      }
    });

    return { years, forecastData, totalCurrent, totalHalfway, totalFinal };
  };

  // Build TFSA Forecast Series (using custom base and catchup rules)
  const buildTfsaForecastSeries = () => {
    const accountDict = getInvestmentBalances('TFSA');
    const yearsToTrack = config.tfsa.horizon_years;
    const currentYear = new Date().getFullYear();
    const accountsList = Object.keys(accountDict);
    const years: number[] = [];
    const forecastData: Record<string, number[]> = {};

    accountsList.forEach(name => {
      forecastData[name] = [];
    });

    for (let yearOffset = 0; yearOffset <= yearsToTrack; yearOffset++) {
      years.push(currentYear + yearOffset);
    }

    let totalCurrent = 0;
    let totalHalfway = 0;
    let totalFinal = 0;
    const halfwayOffset = Math.floor(yearsToTrack / 2);

    const catchupMatch = config.tfsa.catchup.identifier.toUpperCase();
    const baseAnnualContrib = config.tfsa.base.monthly_contribution * 12;
    const wsCatchupYearAnnual = config.tfsa.catchup.catchup_year_contribution;
    const wsFutureAnnual = config.tfsa.annual_room - baseAnnualContrib;

    accountsList.forEach(name => {
      let currentBalance = accountDict[name];
      totalCurrent += currentBalance;

      const upperName = name.toUpperCase();
      const catchupWords = catchupMatch.split(/\s+/).filter(w => w && w !== 'TFSA');
      const isCatchup = upperName.includes(catchupMatch) || 
                        upperName.includes("WEALTHSIMPLE") ||
                        (catchupWords.length > 0 && catchupWords.every(word => upperName.includes(word)));
      const rate = isCatchup ? tfsaWsReturnPct / 100.0 : tfsaBaseReturnPct / 100.0;

      for (let yearOffset = 0; yearOffset <= yearsToTrack; yearOffset++) {
        if (yearOffset === halfwayOffset) totalHalfway += currentBalance;
        if (yearOffset === yearsToTrack) totalFinal += currentBalance;

        forecastData[name].push(currentBalance);

        // Get contribution based on rules
        let contrib = baseAnnualContrib;
        if (isCatchup) {
          contrib = yearOffset === 0 ? wsCatchupYearAnnual : wsFutureAnnual;
        }

        currentBalance = (currentBalance * (1 + rate)) + contrib;
      }
    });

    return { years, forecastData, totalCurrent, totalHalfway, totalFinal };
  };

  // TFSA YTD velocity chart calculations
  const buildTfsaYtdVelocityChart = (): ChartData<'line'> | null => {
    const tfsaCats = config.categories.tfsa_tracking;
    // YTD expenses transactions for TFSA categories
    const tfsaTxns = transactions.filter(t => !t.is_income && tfsaCats.includes(t.Category_Name));
    if (tfsaTxns.length === 0) return null;

    // Sort transactions by date
    tfsaTxns.sort((a, b) => a.date.localeCompare(b.date));

    // Get unique dates
    const dates = Array.from(new Set(tfsaTxns.map(t => t.date)));
    
    // Colors for TFSA tracking categories
    const colors = ['#4f46e5', '#10b981', '#f59e0b', '#f43f5e'];

    const datasets = tfsaCats.map((cat, idx) => {
      const dataPoints: number[] = [];
      let runningSum = 0;

      dates.forEach(date => {
        const dayAmount = tfsaTxns
          .filter(t => t.Category_Name === cat && t.date === date)
          .reduce((acc, t) => acc + t.amount, 0);
        runningSum += dayAmount;
        dataPoints.push(runningSum);
      });

      return {
        label: cat,
        data: dataPoints,
        borderColor: colors[idx % colors.length],
        backgroundColor: `${colors[idx % colors.length]}10`,
        fill: true,
        tension: 0.1,
        borderWidth: 2,
        pointRadius: 2,
      };
    });

    return {
      labels: dates.map(d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
      datasets,
    };
  };

  // Render investment projections content
  const renderInvestmentProjections = () => {
    let years: number[] = [];
    let forecastData: Record<string, number[]> = {};
    let totalCurrent = 0;
    let totalHalfway = 0;
    let totalFinal = 0;
    let horizonYears = 10;

    if (activeInvestTab === 'RESP') {
      const dict = getInvestmentBalances('RESP');
      horizonYears = config.resp.horizon_years;
      const res = buildForecastSeries(
        dict,
        horizonYears,
        respReturnPct / 100.0,
        config.resp.monthly_contribution * 12
      );
      years = res.years;
      forecastData = res.forecastData;
      totalCurrent = res.totalCurrent;
      totalHalfway = res.totalHalfway;
      totalFinal = res.totalFinal;
    } else if (activeInvestTab === 'RRSP') {
      const dict = getInvestmentBalances('RRSP');
      horizonYears = config.rrsp.horizon_years;
      const res = buildForecastSeries(
        dict,
        horizonYears,
        rrspReturnPct / 100.0,
        config.rrsp.annual_contribution
      );
      years = res.years;
      forecastData = res.forecastData;
      totalCurrent = res.totalCurrent;
      totalHalfway = res.totalHalfway;
      totalFinal = res.totalFinal;
    } else if (activeInvestTab === 'TFSA') {
      horizonYears = config.tfsa.horizon_years;
      const res = buildTfsaForecastSeries();
      years = res.years;
      forecastData = res.forecastData;
      totalCurrent = res.totalCurrent;
      totalHalfway = res.totalHalfway;
      totalFinal = res.totalFinal;
    }

    const accountsList = Object.keys(forecastData);
    if (accountsList.length === 0) {
      return <div className="card" style={{ color: 'var(--color-text-secondary)', textAlign: 'center' }}>No accounts found for this category.</div>;
    }

    const currentYear = new Date().getFullYear();
    const halfwayOffset = Math.floor(horizonYears / 2);

    // Prepare chart js datasets
    const colors = ['#6366f1', '#10b981', '#3b82f6', '#f59e0b', '#ec4899'];
    const chartDatasets = accountsList.map((name, idx) => ({
      label: name,
      data: forecastData[name],
      borderColor: colors[idx % colors.length],
      borderWidth: 3,
      tension: 0.15,
      pointRadius: 4,
      pointHoverRadius: 6,
    }));

    const chartData = {
      labels: years.map(String),
      datasets: chartDatasets
    };

    return (
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
                  <span>Base TFSA ({config.tfsa.base.identifier}) YoY Return</span>
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
                  <span>Catch-up TFSA ({config.tfsa.catchup.identifier}) YoY Return</span>
                  <span className="slider-value">{tfsaWsReturnPct}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="15"
                  step="0.5"
                  value={tfsaWsReturnPct}
                  onChange={e => setTfsaWsReturnPct(Number(e.target.value))}
                />
              </div>
            </>
          )}
        </div>

        {/* Projection Metrics */}
        <div className="grid-cols-3" style={{ marginBottom: '1rem' }}>
          <div className="card metric-card">
            <span className="metric-label">Current Total</span>
            <span className="metric-value">${totalCurrent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <div className="card metric-card">
            <span className="metric-label">Halfway Projection ({currentYear + halfwayOffset})</span>
            <span className="metric-value">${Math.round(totalHalfway).toLocaleString()}</span>
          </div>
          <div className="card metric-card">
            <span className="metric-label">Final Projection ({currentYear + horizonYears})</span>
            <span className="metric-value">${Math.round(totalFinal).toLocaleString()}</span>
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
      </div>
    );
  };

  // TFSA YTD details
  const tfsaCats = config.categories.tfsa_tracking;
  const dfYtdExpenses = transactions.filter(t => !t.is_income);
  const dfTfsa = dfYtdExpenses.filter(t => tfsaCats.includes(t.Category_Name));
  const tfsaTotal = dfTfsa.reduce((acc, t) => acc + t.amount, 0);
  const tfsaLimit = config.tfsa.ytd_limit;
  const tfsaProgressPct = tfsaLimit > 0 ? Math.min(tfsaTotal / tfsaLimit, 1.0) : 0;
  const tfsaRemaining = Math.max(tfsaLimit - tfsaTotal, 0);

  const tfsaVelocityChart = buildTfsaYtdVelocityChart();

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
          {/* 1. Monthly Overview Grid */}
          <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: '1.35rem', marginBottom: '1rem' }}>Monthly Overview</h2>
          <div className="grid-cols-4">
            {/* Actual Income */}
            <div className="card metric-card">
              <span className="metric-label">
                Actual Income
                <span className="info-bubble" data-tooltip="Enter any additional expected income for the month (supports expressions like 500+200)">ⓘ</span>
              </span>
              <span className="metric-value">${totalIncome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <input
                type="text"
                className="metric-input"
                placeholder="Forecasted Income (e.g. 500+200)"
                value={addInc}
                onChange={e => setAddInc(e.target.value)}
              />
            </div>

            {/* Actual Expenses */}
            <div className="card metric-card">
              <span className="metric-label">
                Actual Expenses
                <span className="info-bubble" data-tooltip="Enter any additional expected expenses for the month (supports expressions like 100+50)">ⓘ</span>
              </span>
              <span className="metric-value">${totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <input
                type="text"
                className="metric-input"
                placeholder="Forecasted Expense (e.g. 100+50)"
                value={addExp}
                onChange={e => setAddExp(e.target.value)}
              />
            </div>

            {/* Actual Net */}
            <div className="card metric-card">
              <span className="metric-label">Actual Net</span>
              <span className="metric-value" style={{ color: netIncome >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                ${netIncome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className={`metric-delta ${netIncome >= 0 ? 'delta-success' : 'delta-danger'}`}>
                {totalIncome > 0 ? `${savingsRate.toFixed(1)}% savings rate` : ''}
              </span>
            </div>

            {/* Expected Net */}
            <div className="card metric-card">
              <span className="metric-label">Expected Net</span>
              <span className="metric-value" style={{ color: forecastNet >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                ${forecastNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className={`metric-delta ${forecastNet >= 0 ? 'delta-success' : 'delta-danger'}`}>
                {expectedIncome > 0 ? `${expectedSavingsRate.toFixed(1)}% expected savings` : ''}
              </span>
            </div>
          </div>

          {/* 2. Progress Bars */}
          <div className="card" style={{ marginBottom: '2rem' }}>
            {/* Income Progress Bar */}
            <div className="progress-bar-wrapper">
              <div className="progress-bar-header" style={{ color: 'var(--color-success)' }}>
                <span>Income</span>
                <span>Target: ${Math.round(expectedIncome).toLocaleString()}</span>
              </div>
              <div className="progress-bar-track" style={{ borderColor: 'var(--color-success-border)', backgroundColor: 'rgba(16, 185, 129, 0.05)' }}>
                <div className="progress-bar-fill" style={{ width: `${incPct}%`, backgroundColor: 'var(--color-success)' }}>
                  <span className="progress-bar-amount">${totalIncome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>

            {/* Expenses Progress Bar */}
            <div className="progress-bar-wrapper" style={{ marginBottom: 0 }}>
              <div className="progress-bar-header" style={{ color: 'var(--color-danger)' }}>
                <span>Expenses</span>
                <span>Target: ${Math.round(expectedExpenses).toLocaleString()}</span>
              </div>
              <div className="progress-bar-track" style={{ borderColor: 'var(--color-danger-border)', backgroundColor: 'rgba(244, 63, 94, 0.05)' }}>
                <div className="progress-bar-fill" style={{ width: `${expPct}%`, backgroundColor: 'var(--color-danger)' }}>
                  <span className="progress-bar-amount">${totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Envelope Health Checks */}
          <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: '1.35rem', marginBottom: '1rem' }}>Future Envelope Health</h2>
          <div className="grid-cols-3" style={{ marginBottom: '2rem' }}>
            {targetMonthsArr.map(item => {
              const val = underbudget[item.key] || 0;
              return (
                <div className="card metric-card" key={item.key} style={{ borderColor: val > 0 ? 'var(--color-warning-border)' : 'var(--color-success-border)' }}>
                  <span className="metric-label">Underfunded ({item.label})</span>
                  <span className="metric-value" style={{ color: val > 0 ? 'var(--color-warning)' : 'var(--color-success)' }}>
                    ${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className={`metric-delta ${val > 0 ? 'delta-danger' : 'delta-success'}`}>
                    {val > 0 ? 'Action Required' : 'Fully Funded'}
                  </span>
                </div>
              );
            })}
          </div>

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

          {/* 5. Sankey Diagram */}
          <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: '1.35rem', marginBottom: '1rem' }}>Monthly Cashflow</h2>
          <div className="card" style={{ marginBottom: '2rem' }}>
            {/* Summarize categories */}
            {(() => {
              const incSummary: Record<string, number> = {};
              dfIncome.forEach(t => {
                incSummary[t.Category_Name] = (incSummary[t.Category_Name] || 0) + (t.amount * -1);
              });
              const expSummary: Record<string, number> = {};
              dfExpenses.forEach(t => {
                expSummary[t.Category_Name] = (expSummary[t.Category_Name] || 0) + t.amount;
              });

              const incArray = Object.entries(incSummary).map(([Category_Name, amount]) => ({ Category_Name, amount }));
              const expArray = Object.entries(expSummary).map(([Category_Name, amount]) => ({ Category_Name, amount }));

              return <Sankey income={incArray} expenses={expArray} />;
            })()}
          </div>

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
          {tfsaCats.length > 0 && (
            <>
              <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: '1.35rem', marginBottom: '1rem' }}>TFSA Contributions (YTD)</h2>
              <div className="card" style={{ marginBottom: '2rem' }}>
                <div className="grid-cols-4" style={{ marginBottom: '1.5rem' }}>
                  {tfsaCats.map(cat => {
                    const total = dfTfsa.filter(t => t.Category_Name === cat).reduce((acc, t) => acc + t.amount, 0);
                    return (
                      <div className="card metric-card" key={cat} style={{ background: 'rgba(255,255,255,0.02)' }}>
                        <span className="metric-label">{cat}</span>
                        <span className="metric-value" style={{ fontSize: '1.4rem' }}>${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    );
                  })}
                  <div className="card metric-card" style={{ background: 'var(--color-success-bg)', borderColor: 'var(--color-success-border)' }}>
                    <span className="metric-label" style={{ color: 'var(--color-success)' }}>Total Contributed</span>
                    <span className="metric-value" style={{ fontSize: '1.4rem', color: 'var(--color-success)' }}>${tfsaTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    <span className="metric-delta delta-success">
                      {tfsaLimit > 0 ? `${(tfsaTotal / tfsaLimit * 100).toFixed(1)}% of $${tfsaLimit.toLocaleString()} Limit` : ''}
                    </span>
                  </div>
                </div>

                {/* TFSA Limit Progress Bar */}
                <div className="progress-bar-wrapper" style={{ marginBottom: '2rem' }}>
                  <div className="progress-bar-header" style={{ color: 'var(--color-success)' }}>
                    <span>Remaining Room</span>
                    <span>Limit: ${tfsaLimit.toLocaleString()}</span>
                  </div>
                  <div className="progress-bar-track" style={{ borderColor: 'var(--color-success-border)', backgroundColor: 'rgba(16, 185, 129, 0.05)' }}>
                    <div className="progress-bar-fill" style={{ width: `${tfsaProgressPct * 100}%`, backgroundColor: 'var(--color-success)' }}>
                      <span className="progress-bar-amount">${tfsaTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '0.4rem', fontWeight: 600 }}>
                    ${tfsaRemaining.toLocaleString(undefined, { minimumFractionDigits: 2 })} remaining of ${tfsaLimit.toLocaleString()} annual limit
                  </p>
                </div>

                {/* YTD Cumulative Line Chart */}
                {tfsaVelocityChart && (
                  <div>
                    <h3 style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1rem', fontWeight: 700 }}>Contribution Velocity</h3>
                    <div style={{ height: '300px', position: 'relative' }}>
                      <Line
                        data={tfsaVelocityChart}
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
          )}

          {/* 8. Investment Forecasts */}
          <h2 style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: '1.35rem', marginBottom: '1rem' }}>Investment Forecasts</h2>
          <div className="tabs-container">
            {(['RESP', 'RRSP', 'TFSA'] as const).map(tab => (
              <button
                key={tab}
                className={`tab-button ${activeInvestTab === tab ? 'active' : ''}`}
                onClick={() => setActiveInvestTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          {renderInvestmentProjections()}
        </>
      )}
    </div>
  );
}
