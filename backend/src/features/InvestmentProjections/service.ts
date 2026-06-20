/**
 * @file backend/src/features/InvestmentProjections/service.ts
 * @description Service for generating investment projections and mathematical growth models.
 * Parses investment environment variables and provides compound interest forecasts for RESP, RRSP, and TFSA.
 */

import { queryLocalDb } from '../../../server.js';
import type { 
  InvestmentProjectionsPayload, 
  StandardProjectionConfig, 
  TFSAProjectionConfig,
  ProjectionSeries
} from '@shared/types/InvestmentProjections';

export class InvestmentProjectionsService {
  /**
   * Generates a baseline standard projection for an investment account grouping (e.g., RESP, RRSP).
   * 
   * @param accountDict Dictionary mapping account names to current balances in dollars.
   * @param config The configuration containing horizon years, return rate, and annual contribution.
   * @returns The computed projection series.
   */
  public generateStandardProjection(
    accountDict: Record<string, number>,
    config: StandardProjectionConfig
  ): ProjectionSeries {
    const currentYear = new Date().getFullYear();
    const forecastData: Record<string, number[]> = {};
    const years: number[] = [];
    const accountsList = Object.keys(accountDict);
    
    accountsList.forEach(name => {
      forecastData[name] = [];
    });

    for (let yearOffset = 0; yearOffset <= config.horizonYears; yearOffset++) {
      years.push(currentYear + yearOffset);
    }

    let totalCurrent = 0;
    let totalHalfway = 0;
    let totalFinal = 0;
    const halfwayOffset = Math.floor(config.horizonYears / 2);
    const returnRateDecimal = config.defaultReturnPct / 100.0;

    accountsList.forEach(name => {
      let currentBalance = accountDict[name];
      totalCurrent += currentBalance;

      for (let yearOffset = 0; yearOffset <= config.horizonYears; yearOffset++) {
        if (yearOffset === halfwayOffset) totalHalfway += currentBalance;
        if (yearOffset === config.horizonYears) totalFinal += currentBalance;

        forecastData[name].push(currentBalance);
        
        // --- MATHEMATICAL GROWTH MODEL ---
        // Compound Interest Formula (Annual Compounding + Annual Contribution):
        // Balance_{t} = Balance_{t-1} * (1 + r) + C
        // Where:
        // - r is the expected annual return rate (e.g., 0.08 for 8%)
        // - C is the planned annual contribution
        currentBalance = (currentBalance * (1 + returnRateDecimal)) + config.annualContribution;
      }
    });

    return { years, forecastData, totalCurrent, totalHalfway, totalFinal };
  }

  /**
   * Generates the projection specifically for the TFSA, applying base and catch-up rules.
   * 
   * @param accountDict Dictionary mapping account names to current balances in dollars.
   * @param config The TFSA specific configuration.
   * @returns The computed TFSA projection series.
   */
  public generateTFSAProjection(
    accountDict: Record<string, number>,
    config: TFSAProjectionConfig
  ): ProjectionSeries {
    const currentYear = new Date().getFullYear();
    const accountsList = Object.keys(accountDict);
    const years: number[] = [];
    const forecastData: Record<string, number[]> = {};

    accountsList.forEach(name => {
      forecastData[name] = [];
    });

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
      let currentBalance = accountDict[name];
      totalCurrent += currentBalance;

      const upperName = name.toUpperCase();
      const catchupWords = catchupMatch.split(/\s+/).filter(w => w && w !== 'TFSA');
      const isCatchup = upperName.includes(catchupMatch) || 
                        upperName.includes("WEALTHSIMPLE") ||
                        (catchupWords.length > 0 && catchupWords.every(word => upperName.includes(word)));
                        
      const rate = isCatchup ? (config.catchup.defaultReturnPct / 100.0) : (config.base.defaultReturnPct / 100.0);

      for (let yearOffset = 0; yearOffset <= config.horizonYears; yearOffset++) {
        if (yearOffset === halfwayOffset) totalHalfway += currentBalance;
        if (yearOffset === config.horizonYears) totalFinal += currentBalance;

        forecastData[name].push(currentBalance);

        // Determine contribution amount based on year and account type
        let contrib = baseAnnualContrib;
        if (isCatchup) {
          contrib = yearOffset === 0 ? wsCatchupYearAnnual : wsFutureAnnual;
        }

        // --- MATHEMATICAL GROWTH MODEL ---
        // Compound Interest Formula for TFSA (Annual Compounding + Dynamic Contribution):
        // Balance_{t} = Balance_{t-1} * (1 + r) + C_{t}
        // Where:
        // - r is the assigned account rate (base or catchup rate)
        // - C_{t} is the dynamic contribution logic for the catchup rules
        currentBalance = (currentBalance * (1 + rate)) + contrib;
      }
    });

    return { years, forecastData, totalCurrent, totalHalfway, totalFinal };
  }

  /**
   * Retrieves account balances and baseline projection configuration.
   */
  public async getProjectionsData(): Promise<InvestmentProjectionsPayload> {
    const cleanEnvString = (val: string | undefined, defaultVal: string = ''): string => {
      if (!val) return defaultVal;
      return val.trim().replace(/^['"]|['"]$/g, '');
    };

    const respConfig: StandardProjectionConfig = {
      identifier: cleanEnvString(process.env.ACTUAL_RESP_IDENTIFIER, 'RESP'),
      horizonYears: Number(process.env.ACTUAL_RESP_HORIZON_YEARS || 10),
      defaultReturnPct: Number(process.env.ACTUAL_RESP_DEFAULT_RETURN_PCT || 4.0),
      annualContribution: Number(process.env.ACTUAL_RESP_MONTHLY_CONTRIBUTION || 0.0) * 12,
    };

    const rrspConfig: StandardProjectionConfig = {
      identifier: cleanEnvString(process.env.ACTUAL_RRSP_IDENTIFIER, 'RRSP'),
      horizonYears: Number(process.env.ACTUAL_RRSP_HORIZON_YEARS || 30),
      defaultReturnPct: Number(process.env.ACTUAL_RRSP_DEFAULT_RETURN_PCT || 8.0),
      annualContribution: Number(process.env.ACTUAL_RRSP_ANNUAL_CONTRIBUTION || 0.0),
    };

    const tfsaConfig: TFSAProjectionConfig = {
      horizonYears: Number(process.env.ACTUAL_TFSA_HORIZON_YEARS || 30),
      totalRoom: Number(process.env.ACTUAL_TFSA_TOTAL_ROOM || process.env.ACTUAL_TFSA_ANNUAL_ROOM || 7000.0),
      base: {
        identifier: cleanEnvString(process.env.ACTUAL_TFSA_BASE_IDENTIFIER, ''),
        defaultReturnPct: Number(process.env.ACTUAL_TFSA_BASE_DEFAULT_RETURN_PCT || 4.0),
        monthlyContribution: Number(process.env.ACTUAL_TFSA_BASE_MONTHLY_CONTRIBUTION || 0.0),
      },
      catchup: {
        identifier: cleanEnvString(process.env.ACTUAL_TFSA_CATCHUP_IDENTIFIER, ''),
        defaultReturnPct: Number(process.env.ACTUAL_TFSA_CATCHUP_DEFAULT_RETURN_PCT || 8.0),
        catchupYearContribution: Number(process.env.ACTUAL_TFSA_CATCHUP_YEAR_CONTRIBUTION || 0.0),
      }
    };

    const hasRESP = !!(
      process.env.ACTUAL_RESP_IDENTIFIER ||
      process.env.ACTUAL_RESP_HORIZON_YEARS ||
      process.env.ACTUAL_RESP_DEFAULT_RETURN_PCT ||
      process.env.ACTUAL_RESP_MONTHLY_CONTRIBUTION
    );

    const hasRRSP = !!(
      process.env.ACTUAL_RRSP_IDENTIFIER ||
      process.env.ACTUAL_RRSP_HORIZON_YEARS ||
      process.env.ACTUAL_RRSP_DEFAULT_RETURN_PCT ||
      process.env.ACTUAL_RRSP_ANNUAL_CONTRIBUTION
    );

    const hasTFSA = !!(
      process.env.ACTUAL_TFSA_TRACKING ||
      process.env.ACTUAL_TFSA_HORIZON_YEARS ||
      process.env.ACTUAL_TFSA_TOTAL_ROOM ||
      process.env.ACTUAL_TFSA_ANNUAL_ROOM ||
      process.env.ACTUAL_TFSA_BASE_IDENTIFIER ||
      process.env.ACTUAL_TFSA_CATCHUP_IDENTIFIER
    );

    const hasInvestments = hasRESP || hasRRSP || hasTFSA;

    // Fetch accounts and balances
    const rawAccounts = await queryLocalDb(`
      SELECT 
        a.id, 
        a.name, 
        a.offbudget, 
        a.closed, 
        COALESCE(SUM(t.amount), 0) as balance_current
      FROM accounts a
      LEFT JOIN v_transactions t ON a.id = t.account AND t.tombstone = 0 AND t.is_parent = 0
      WHERE a.tombstone = 0 AND a.closed = 0
      GROUP BY a.id, a.name, a.offbudget, a.closed
    `);

    const respBalances: Record<string, number> = {};
    const rrspBalances: Record<string, number> = {};
    const tfsaBalances: Record<string, number> = {};

    const respId = respConfig.identifier.toUpperCase();
    const rrspId = rrspConfig.identifier.toUpperCase();
    const tfsaId = tfsaConfig.base.identifier.toUpperCase();
    const tfsaCatchupId = tfsaConfig.catchup.identifier.toUpperCase();

    rawAccounts.forEach((acc: any) => {
      if (!acc.offbudget || acc.closed) return;
      const name = acc.name.toUpperCase();
      const balance = acc.balance_current / 100.0;

      if (hasRESP && name.includes(respId)) {
        respBalances[acc.name] = balance;
      }
      if (hasRRSP && name.includes(rrspId)) {
        rrspBalances[acc.name] = balance;
      }
      if (hasTFSA && (name.includes('TFSA') || name.includes(tfsaId) || name.includes(tfsaCatchupId))) {
        tfsaBalances[acc.name] = balance;
      }
    });

    const respProjection = hasRESP ? this.generateStandardProjection(respBalances, respConfig) : null;
    const rrspProjection = hasRRSP ? this.generateStandardProjection(rrspBalances, rrspConfig) : null;
    const tfsaProjection = hasTFSA ? this.generateTFSAProjection(tfsaBalances, tfsaConfig) : null;

    return {
      hasInvestments,
      hasRESP,
      hasRRSP,
      hasTFSA,
      respConfig,
      rrspConfig,
      tfsaConfig,
      respBalances,
      rrspBalances,
      tfsaBalances,
      respProjection,
      rrspProjection,
      tfsaProjection
    };
  }
}
