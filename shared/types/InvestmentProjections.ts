/**
 * @file shared/types/InvestmentProjections.ts
 * @description Shared types for the Investment Projections feature slice.
 */

/**
 * Standard projection configuration for RESP and RRSP.
 */
export interface StandardProjectionConfig {
  identifier: string;
  horizonYears: number;
  defaultReturnPct: number;
  annualContribution: number; // For RESP, this is monthly * 12
}

/**
 * Advanced projection configuration for TFSA, which supports a base and catchup account.
 */
export interface TFSAProjectionConfig {
  horizonYears: number;
  totalRoom: number;
  base: {
    identifier: string;
    defaultReturnPct: number;
    monthlyContribution: number;
  };
  catchup: {
    identifier: string;
    defaultReturnPct: number;
    catchupYearContribution: number;
  };
}

/**
 * Computed projection series data.
 */
export interface ProjectionSeries {
  years: number[];
  forecastData: Record<string, number[]>;
  totalCurrent: number;
  totalHalfway: number;
  totalFinal: number;
}

/**
 * Main payload returned by the Investment Projections baseline API.
 */
export interface InvestmentProjectionsPayload {
  hasInvestments: boolean;
  hasRESP: boolean;
  hasRRSP: boolean;
  hasTFSA: boolean;
  
  respConfig: StandardProjectionConfig;
  rrspConfig: StandardProjectionConfig;
  tfsaConfig: TFSAProjectionConfig;
  
  respBalances: Record<string, number>;
  rrspBalances: Record<string, number>;
  tfsaBalances: Record<string, number>;
  
  // Initial server-side projections computed with default rates
  respProjection: ProjectionSeries | null;
  rrspProjection: ProjectionSeries | null;
  tfsaProjection: ProjectionSeries | null;
}
