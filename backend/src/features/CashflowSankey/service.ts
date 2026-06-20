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

    // We calculate the layout on a fixed 900x600 canvas.
    // The frontend can scale this inherently using SVG viewBox and preserveAspectRatio.
    const width = 900;
    const height = 600;
    const leftPadding = 150;
    const rightPadding = 200; // Increased padding to prevent label truncation
    const paddingY = 40;
    const colWidth = 20;
    
    // Distribute remaining width evenly across the 3 horizontal gaps between 4 columns
    const colSpacing = (width - leftPadding - rightPadding - colWidth * 4) / 3;

    const activeIncome = data.income.filter((x: any) => x.amount > 0);
    const activeExpenses = data.expenses.filter((x: any) => x.amount > 0);

    const totalIncome = activeIncome.reduce((acc: number, x: any) => acc + x.amount, 0);
    const totalExpenses = activeExpenses.reduce((acc: number, x: any) => acc + x.amount, 0);
    const netFlow = totalIncome - totalExpenses;

    if (activeIncome.length === 0 && activeExpenses.length === 0) {
      return { nodes: [], links: [], width, height };
    }

    // The maximum volume moving through the system dictates the scale
    const systemFlow = Math.max(totalIncome, totalExpenses);
    const chartHeight = height - paddingY * 2;

    const nodes: SankeyNode[] = [];
    const col0X = leftPadding;
    const col1X = leftPadding + colWidth + colSpacing;
    const col2X = leftPadding + (colWidth + colSpacing) * 2;
    const col3X = leftPadding + (colWidth + colSpacing) * 3;

    // --- 1. Column 0: Income items and Deficit ---
    let col0Y = paddingY;
    const col0Items = [...activeIncome];
    if (netFlow < 0) {
      // If expenses exceed income, add a fake "Deficit" income to balance the flows
      col0Items.push({ Category_Name: 'Overspending (Deficit)', amount: Math.abs(netFlow) });
    }
    const col0Gap = col0Items.length > 1 ? 15 : 0;
    const totalCol0Gaps = col0Gap * (col0Items.length - 1);
    const col0Scale = systemFlow > 0 ? (chartHeight - totalCol0Gaps) / systemFlow : 0;

    const col0Nodes = col0Items.map((item: any) => {
      const nodeH = item.amount * col0Scale;
      const nodeY = col0Y;
      col0Y += nodeH + col0Gap;
      return {
        id: `c0_${item.Category_Name}`,
        label: item.Category_Name,
        x: col0X,
        y: nodeY,
        w: colWidth,
        h: Math.max(nodeH, 2), // Ensure node is at least 2px tall
        color: item.Category_Name === 'Overspending (Deficit)' ? 'var(--color-warning)' : 'var(--color-success)',
        amount: item.amount
      };
    });
    nodes.push(...col0Nodes);

    // --- 2. Column 1: Central Hub (Monthly Cashflow) ---
    const col1H = systemFlow * col0Scale;
    const col1Node = {
      id: 'c1_hub',
      label: 'Monthly Cashflow',
      x: col1X,
      y: paddingY,
      w: colWidth,
      h: col1H,
      color: '#64748b',
      amount: systemFlow
    };
    nodes.push(col1Node);

    // --- 3. Column 2: Total Expenses and Savings (Net Income) ---
    let col2Y = paddingY;
    const col2Items: any[] = [];
    if (totalExpenses > 0) {
      col2Items.push({ Category_Name: 'Total Expenses', amount: totalExpenses });
    }
    if (netFlow > 0) {
      // If income exceeds expenses, route remainder to Savings
      col2Items.push({ Category_Name: 'Savings (Net Income)', amount: netFlow });
    }
    const col2Gap = col2Items.length > 1 ? 25 : 0;
    const totalCol2Gaps = col2Gap * (col2Items.length - 1);
    const col2Scale = systemFlow > 0 ? (chartHeight - totalCol2Gaps) / systemFlow : 0;

    const col2Nodes = col2Items.map((item: any) => {
      const nodeH = item.amount * col2Scale;
      const nodeY = col2Y;
      col2Y += nodeH + col2Gap;
      return {
        id: `c2_${item.Category_Name}`,
        label: item.Category_Name,
        x: col2X,
        y: nodeY,
        w: colWidth,
        h: Math.max(nodeH, 2),
        color: item.Category_Name === 'Total Expenses' ? 'var(--color-danger)' : 'var(--color-success)',
        amount: item.amount
      };
    });
    nodes.push(...col2Nodes);

    // --- 4. Column 3: Individual Expenses ---
    const col3Gap = activeExpenses.length > 1 ? 12 : 0;
    const totalCol3Gaps = col3Gap * (activeExpenses.length - 1);
    
    // Scale for Column 3 nodes uses the height of the Total Expenses node
    const col3Scale = totalExpenses > 0 ? (totalExpenses * col2Scale - totalCol3Gaps) / totalExpenses : 0;

    const col2ExpensesNode = col2Nodes.find((n: any) => n.label === 'Total Expenses');
    const startY = col2ExpensesNode ? col2ExpensesNode.y : paddingY;

    let currentCol3Y = startY;
    const col3Nodes = activeExpenses.map((item: any) => {
      const nodeH = item.amount * col3Scale;
      const nodeY = currentCol3Y;
      currentCol3Y += nodeH + col3Gap;
      return {
        id: `c3_${item.Category_Name}`,
        label: item.Category_Name,
        x: col3X,
        y: nodeY,
        w: colWidth,
        h: Math.max(nodeH, 2),
        color: 'var(--color-danger)',
        amount: item.amount
      };
    });
    nodes.push(...col3Nodes);

    // --- Links definition and positioning ---
    const links: SankeyLink[] = [];
    
    // Track vertical offsets as links stack onto nodes
    const nodeOutputOffsets: Record<string, number> = {};
    const nodeInputOffsets: Record<string, number> = {};

    /**
     * Adds a Bezier curve link between a source node and target node.
     * Computes start and end Y offsets to stack flows accurately.
     */
    const addLink = (sourceId: string, targetId: string, flowAmount: number, linkColor: string) => {
      const sNode = nodes.find(n => n.id === sourceId);
      const tNode = nodes.find(n => n.id === targetId);
      if (!sNode || !tNode) return;

      const sOffset = nodeOutputOffsets[sourceId] || 0;
      const sRatio = sNode.h / sNode.amount;
      const linkH = flowAmount * sRatio;
      const y1 = sNode.y + sOffset + linkH / 2;
      nodeOutputOffsets[sourceId] = sOffset + linkH;

      const tOffset = nodeInputOffsets[targetId] || 0;
      const tRatio = tNode.h / tNode.amount;
      const linkHIn = flowAmount * tRatio;
      const y2 = tNode.y + tOffset + linkHIn / 2;
      nodeInputOffsets[targetId] = tOffset + linkHIn;

      const x1 = sNode.x + sNode.w;
      const x2 = tNode.x;

      // Control points for the SVG Cubic Bezier curve
      const cx1 = x1 + colSpacing / 2;
      const cx2 = x2 - colSpacing / 2;

      const pathD = `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`;

      links.push({
        d: pathD,
        strokeWidth: Math.max(linkH, 1),
        color: linkColor,
        tooltip: `${sNode.label} \u2192 ${tNode.label}: $${flowAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      });
    };

    // Build links Column 0 -> Column 1
    col0Nodes.forEach((n: any) => {
      const color = n.label === 'Overspending (Deficit)' ? 'rgba(245, 158, 11, 0.25)' : 'rgba(16, 185, 129, 0.25)';
      addLink(n.id, 'c1_hub', n.amount, color);
    });

    // Build links Column 1 -> Column 2
    const col2Expenses = col2Nodes.find((n: any) => n.label === 'Total Expenses');
    if (col2Expenses) {
      addLink('c1_hub', col2Expenses.id, totalExpenses, 'rgba(244, 63, 94, 0.2)');
    }
    const col2Savings = col2Nodes.find((n: any) => n.label === 'Savings (Net Income)');
    if (col2Savings) {
      addLink('c1_hub', col2Savings.id, netFlow, 'rgba(16, 185, 129, 0.25)');
    }

    // Build links Column 2 -> Column 3
    if (col2Expenses) {
      col3Nodes.forEach((n: any) => {
        addLink(col2Expenses.id, n.id, n.amount, 'rgba(244, 63, 94, 0.2)');
      });
    }

    return {
      nodes,
      links,
      width,
      height
    };
  }
}
