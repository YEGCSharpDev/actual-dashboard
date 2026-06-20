/**
 * @file shared/types/CashflowSankey.ts
 * @description Types defining the data payload for the Cashflow Sankey visualization slice.
 */

/**
 * Represents a single node (category or hub) in the Sankey diagram.
 */
export interface SankeyNode {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  amount: number;
}

/**
 * Represents a link (flow) between two nodes in the Sankey diagram.
 */
export interface SankeyLink {
  d: string;
  strokeWidth: number;
  color: string;
  tooltip: string;
}

/**
 * The complete payload for rendering the Cashflow Sankey diagram.
 */
export interface CashflowSankeyPayload {
  nodes: SankeyNode[];
  links: SankeyLink[];
  width: number;
  height: number;
}
