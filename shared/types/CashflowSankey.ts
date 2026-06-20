/**
 * @file shared/types/CashflowSankey.ts
 * @description Types defining the structured financial data payload for the Cashflow Sankey visualization.
 */

export interface SankeyNode {
  id: string;
  label: string;
  amount: number;
}

export interface SankeyLink {
  sourceId: string;
  targetId: string;
  amount: number;
}

export interface CashflowSankeyPayload {
  nodes: SankeyNode[];
  links: SankeyLink[];
}
