/**
 * @file backend/src/features/InvestmentProjections/service.ts
 * @description Service for generating investment projections and mathematical growth models.
 * Parses investment environment variables and provides compound interest forecasts for RESP, RRSP, and TFSA.
 */

import type { IDbClient } from '../../infrastructure/db/IDbClient.js';
import { defaultDbClient } from '../../../db.js';
import type { 
  InvestmentProjectionsPayload, 
  StandardProjectionConfig, 
  TFSAProjectionConfig,
  ProjectionSeries
} from '@shared/types/InvestmentProjections';
import { investmentConfig } from '../../../../shared/config/env.js';

export class InvestmentProjectionsService {
  constructor(private db: IDbClient = defaultDbClient) {}

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
      const isCatchup = catchupMatch !== '' && (
        upperName.includes(catchupMatch) || 
        (catchupWords.length > 0 && catchupWords.every(word => upperName.includes(word)))
      );
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
    const {
      hasInvestments,
      hasRESP,
      hasRRSP,
      hasTFSA,
      resp: respConfig,
      rrsp: rrspConfig,
      tfsa: tfsaConfig
    } = investmentConfig;

    // Fetch accounts and balances
    const rawAccounts = await this.db.query(`
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
