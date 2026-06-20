import type { StandardProjectionConfig, TFSAProjectionConfig } from '../types/InvestmentProjections';

export const cleanEnvString = (val: string | undefined, defaultVal: string = ''): string => {
  if (!val) return defaultVal;
  return val.trim().replace(/^['"]|['"]$/g, '');
};

export const parseJsonEnvArray = (val: string | undefined): string[] => {
  if (!val) return [];
  const clean = val.trim().replace(/^['"]|['"]$/g, '');
  try {
    return JSON.parse(clean);
  } catch (err) {
    console.error(`Failed to parse JSON env array: "${val}"`, err);
    return [];
  }
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

const tfsaYtdLimit = Number(process.env.ACTUAL_TFSA_YTD_LIMIT || 7000.0);
const tfsaTracking = parseJsonEnvArray(process.env.ACTUAL_TFSA_TRACKING);
const budgetTracking = parseJsonEnvArray(process.env.ACTUAL_BUDGET_TRACKING);

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
  process.env.ACTUAL_TFSA_CATCHUP_IDENTIFIER ||
  process.env.ACTUAL_TFSA_YTD_LIMIT
);

const hasInvestments = hasRESP || hasRRSP || hasTFSA;

export const investmentConfig = {
  resp: respConfig,
  rrsp: rrspConfig,
  tfsa: tfsaConfig,
  tfsaYtdLimit,
  tfsaTracking,
  budgetTracking,
  hasRESP,
  hasRRSP,
  hasTFSA,
  hasInvestments
} as const;
