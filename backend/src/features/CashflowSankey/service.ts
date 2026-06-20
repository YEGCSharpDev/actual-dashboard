/**
 * @file backend/src/features/CashflowSankey/service.ts
 * @description Service to calculate the geometry and layout for the Cashflow Sankey diagram.
 * 
 * We extract the data-munging logic from the frontend to enforce Vertical Slice Architecture.
 * This service computes absolute coordinates for the nodes and SVG paths for the links.
 */

import type { CashflowSankeyPayload, SankeyNode, SankeyLink } from '@shared/types/CashflowSankey';
import type { IDbClient } from '../../infrastructure/db/IDbClient.js';
import { defaultDbClient } from '../../../db.js';
import { getMonthlySpending } from '../../shared/queries/getMonthlySpending.js';

export class CashflowSankeyService {
  constructor(private db: IDbClient = defaultDbClient) {}

  /**
   * Generates nodes and links for the Sankey diagram based on monthly spending data.
   * Calculates all dimensions, spacing, and bezier curves for SVG paths.
   * 
   * @param selectedMonth The target month in YYYY-MM format.
   * @returns A promise resolving to the Sankey visualization payload (nodes and links).
   */
  public async getSankeyData(selectedMonth: string): Promise<CashflowSankeyPayload> {
    const data = await getMonthlySpending(this.db, selectedMonth);

    const activeIncome = data.income.filter((x: any) => x.amount > 0);
    const activeExpenses = data.expenses.filter((x: any) => x.amount > 0);

    const totalIncome = activeIncome.reduce((acc: number, x: any) => acc + x.amount, 0);
    const totalExpenses = activeExpenses.reduce((acc: number, x: any) => acc + x.amount, 0);
    const netFlow = totalIncome - totalExpenses;

    if (activeIncome.length === 0 && activeExpenses.length === 0) {
      return { nodes: [], links: [] };
    }

    const systemFlow = Math.max(totalIncome, totalExpenses);

    const nodes: SankeyNode[] = [];
    const links: SankeyLink[] = [];

    // --- 1. Column 0: Income items and Deficit ---
    const col0Items = [...activeIncome];
    if (netFlow < 0) {
      col0Items.push({ Category_Name: 'Overspending (Deficit)', amount: Math.abs(netFlow) });
    }

    col0Items.forEach((item: any) => {
      nodes.push({
        id: `c0_${item.Category_Name}`,
        label: item.Category_Name,
        amount: item.amount
      });
      links.push({
        sourceId: `c0_${item.Category_Name}`,
        targetId: 'c1_hub',
        amount: item.amount
      });
    });

    // --- 2. Column 1: Central Hub ---
    nodes.push({
      id: 'c1_hub',
      label: 'Monthly Cashflow',
      amount: systemFlow
    });

    // --- 3. Column 2: Total Expenses and Savings ---
    if (totalExpenses > 0) {
      nodes.push({
        id: 'c2_Total Expenses',
        label: 'Total Expenses',
        amount: totalExpenses
      });
      links.push({
        sourceId: 'c1_hub',
        targetId: 'c2_Total Expenses',
        amount: totalExpenses
      });
    }
    
    if (netFlow > 0) {
      nodes.push({
        id: 'c2_Savings (Net Income)',
        label: 'Savings (Net Income)',
        amount: netFlow
      });
      links.push({
        sourceId: 'c1_hub',
        targetId: 'c2_Savings (Net Income)',
        amount: netFlow
      });
    }

    // --- 4. Column 3: Individual Expenses ---
    activeExpenses.forEach((item: any) => {
      nodes.push({
        id: `c3_${item.Category_Name}`,
        label: item.Category_Name,
        amount: item.amount
      });
      links.push({
        sourceId: 'c2_Total Expenses',
        targetId: `c3_${item.Category_Name}`,
        amount: item.amount
      });
    });

    return {
      nodes,
      links
    };
  }
}
