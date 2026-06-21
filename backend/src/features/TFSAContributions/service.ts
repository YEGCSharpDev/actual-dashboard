/**
 * @file backend/src/features/TFSAContributions/service.ts
 * @description Service containing the business logic and database queries for
 * calculating Year-to-Date TFSA Contributions and charting data.
 */

import type { IDbClient } from '../../infrastructure/db/IDbClient.js';
import { defaultDbClient } from '../../db/client.js';
import type { TFSAYearToDateResponse, TFSAChartData, TFSAChartDataset } from '@shared/types/TFSAContributions.js';
import { investmentConfig } from '../../../../shared/config/env.js';
import { CENTS_TO_DOLLARS_OUTFLOW_POSITIVE } from '../../../../shared/constants/financial.js';

export class TFSAContributionsService {
  constructor(private db: IDbClient = defaultDbClient) {}

  /**
   * Retrieves YTD TFSA contribution tracking data.
   * Pulls environment variables to determine limits and tracking categories.
   * 
   * @returns A promise resolving to the TFSA YTD payload.
   */
  public async getYearToDateContributions(): Promise<TFSAYearToDateResponse> {
    const tfsaCats = investmentConfig.tfsaTracking;
    const ytdLimit = investmentConfig.tfsaYtdLimit;
    const totalRoom = investmentConfig.tfsa.totalRoom;
    const hasTFSA = investmentConfig.hasTFSA;

    if (!hasTFSA || tfsaCats.length === 0) {
      return {
        hasTFSA,
        ytdLimit,
        totalRoom,
        ytdTotal: 0,
        remainingLimit: ytdLimit,
        progressPct: 0,
        categories: [],
        velocityChart: null
      };
    }

    const currentYear = new Date().getFullYear();
    const startDate = `${currentYear}0101`;

    // Query all relevant transactions for the current year
    const transactions = await this.db.query(`
      SELECT 
        t.date, 
        t.amount, 
        c.name as category_name,
        a.offbudget as account_offbudget,
        c.is_income as category_is_income
      FROM v_transactions t
      LEFT JOIN categories c ON t.category = c.id
      LEFT JOIN accounts a ON t.account = a.id
      WHERE t.tombstone = 0 
        AND t.is_parent = 0
        AND t.date >= ?
    `, [startDate]);

    const formatDate = (rawDate: any): string => {
      if (!rawDate) return '';
      const str = String(rawDate);
      if (str.length === 8) {
        return `${str.substring(0, 4)}-${str.substring(4, 6)}-${str.substring(6, 8)}`;
      }
      return str;
    };

    // Filter to TFSA expenses on-budget
    const tfsaTxns = transactions
      .filter((t: any) => !t.category_is_income && !t.account_offbudget && tfsaCats.includes(t.category_name))
      .map((t: any) => ({
        date: formatDate(t.date),
        amount: t.amount / CENTS_TO_DOLLARS_OUTFLOW_POSITIVE,
        category: t.category_name
      }));

    const ytdTotal = tfsaTxns.reduce((acc: number, t: any) => acc + t.amount, 0);
    const progressPct = ytdLimit > 0 ? Math.min(ytdTotal / ytdLimit, 1.0) : 0;
    const remainingLimit = Math.max(ytdLimit - ytdTotal, 0);

    const categories = tfsaCats.map(cat => {
      const total = tfsaTxns.filter((t: any) => t.category === cat).reduce((acc: number, t: any) => acc + t.amount, 0);
      return { name: cat, total };
    });

    // Build velocity chart
    let velocityChart: TFSAChartData | null = null;
    if (tfsaTxns.length > 0) {
      tfsaTxns.sort((a: any, b: any) => a.date.localeCompare(b.date));
      const dates = Array.from(new Set(tfsaTxns.map((t: any) => t.date)));
      const colors = ['#4f46e5', '#10b981', '#f59e0b', '#f43f5e'];

      const datasets: TFSAChartDataset[] = tfsaCats.map((cat, idx) => {
        const dataPoints: number[] = [];
        let runningSum = 0;

        dates.forEach(date => {
          const dayAmount = tfsaTxns
            .filter((t: any) => t.category === cat && t.date === date)
            .reduce((acc: number, t: any) => acc + t.amount, 0);
          runningSum += dayAmount;
          dataPoints.push(runningSum);
        });

        const color = colors[idx % colors.length];
        return {
          label: cat,
          data: dataPoints,
          borderColor: color,
          backgroundColor: `${color}10`,
          fill: true,
          tension: 0.1,
          borderWidth: 2,
          pointRadius: 2,
        };
      });

      velocityChart = {
        labels: dates.map(d => new Date((d as string) + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })),
        datasets
      };
    }

    return {
      hasTFSA,
      ytdLimit,
      totalRoom,
      ytdTotal,
      remainingLimit,
      progressPct,
      categories,
      velocityChart
    };
  }
}
