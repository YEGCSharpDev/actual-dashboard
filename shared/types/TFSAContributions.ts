/**
 * @file shared/types/TFSAContributions.ts
 * @description Shared TypeScript types for the TFSA Contributions feature slice.
 * Defines the data payload passed from the backend API to the UI.
 */

/**
 * Represents a single dataset in the TFSA velocity chart.
 */
export interface TFSAChartDataset {
  label: string;
  data: number[];
  borderColor: string;
  backgroundColor: string;
  fill: boolean;
  tension: number;
  borderWidth: number;
  pointRadius: number;
}

/**
 * Represents the complete configuration for the TFSA velocity chart.
 */
export interface TFSAChartData {
  labels: string[];
  datasets: TFSAChartDataset[];
}

/**
 * The main payload for the Year-To-Date TFSA Contributions dashboard.
 */
export interface TFSAYearToDateResponse {
  /** If TFSA tracking is enabled in the environment. */
  hasTFSA: boolean;
  /** The limit for the current year. */
  ytdLimit: number;
  /** The total lifetime limit/room available. */
  totalRoom: number;
  /** The amount contributed so far this year. */
  ytdTotal: number;
  /** The remaining limit for the current year. */
  remainingLimit: number;
  /** The progress percentage (0.0 to 1.0) towards the YTD limit. */
  progressPct: number;
  /** Breakdown of contributions by category. */
  categories: {
    name: string;
    total: number;
  }[];
  /** Chart data for the contribution velocity over time. */
  velocityChart: TFSAChartData | null;
}
