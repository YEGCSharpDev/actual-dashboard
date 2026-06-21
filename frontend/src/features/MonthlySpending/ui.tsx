/**
 * @file frontend/src/features/MonthlySpending/ui.tsx
 * @description React UI components for the Monthly Spending Analytics vertical slice.
 * Exports MonthlySpendingOverview (metrics & progress bars).
 */

import React, { useState, useEffect } from 'react';
import { useMonthlySpending } from './api';

/**
 * Props for the Monthly Spending components.
 */
interface MonthlySpendingProps {
  /** The currently selected month in YYYY-MM format */
  selectedMonth: string;
  /** ISO string of the last sync time to trigger data refreshes */
  lastSyncTime: string | null;
}

/**
 * Safely parses and evaluates basic arithmetic expression strings (e.g., "500+200").
 * Excludes illegal characters to prevent arbitrary script execution.
 * 
 * @param exprStr The math expression string to evaluate.
 * @returns The evaluated numeric result, or 0 if invalid.
 */
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

/**
 * Helper evaluator logic for basic arithmetic operators.
 * 
 * @param expr The cleaned expression string.
 * @returns Evaluated numeric value.
 */
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

/**
 * Component for rendering the Monthly Overview metric cards and target progress bars.
 */
export const MonthlySpendingOverview: React.FC<MonthlySpendingProps> = ({
  selectedMonth,
  lastSyncTime
}) => {
  const { data, loading, error, refetch } = useMonthlySpending(selectedMonth);
  const [addInc, setAddInc] = useState<string>('0');
  const [addExp, setAddExp] = useState<string>('0');

  useEffect(() => {
    refetch();
  }, [lastSyncTime, refetch]);

  useEffect(() => {
    setAddInc('0');
    setAddExp('0');
  }, [selectedMonth]);

  if (loading && !data) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '3rem 0', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ width: '24px', height: '24px', border: '2px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--color-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>Loading overview metrics...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ borderColor: 'var(--color-danger-border)', padding: '1.5rem', textAlign: 'center', marginBottom: '2rem' }}>
        <p style={{ color: 'var(--color-danger)', fontWeight: 600, fontSize: '0.9rem' }}>Failed to load Monthly Overview</p>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem' }}>{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { totalIncome, totalSpent, netIncome, savingsRate } = data;

  const expectedIncome = totalIncome + parseMathInput(addInc);
  const expectedExpenses = totalSpent + parseMathInput(addExp);
  const forecastNet = expectedIncome - expectedExpenses;
  const expectedSavingsRate = expectedIncome > 0 ? (forecastNet / expectedIncome) * 100 : 0;

  const maxExpected = Math.max(expectedIncome, expectedExpenses, 1.0);
  const incPct = Math.min((totalIncome / maxExpected) * 100, 100.0);
  const expPct = Math.min((totalSpent / maxExpected) * 100, 100.0);

  return (
    <>
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
    </>
  );
};

