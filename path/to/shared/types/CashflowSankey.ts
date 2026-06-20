// shared/types/CashflowSankey.ts
/**
 * Defines the structure for a single cash flow transaction.
 */
export interface CashflowTransaction {
    id: string;
    type: 'income' | 'expense';
    amount: number;
    month: number;
}

/**
 * Defines the structure for a node in the Sankey diagram.
 */
export interface SankeyNode {
    id: string;
    label: string;
    value: number;
    // Coordinates for positioning the node in the visualization space
    x: number;
    y: number;
}

/**
 * Defines the structure for a link (flow) in the Sankey diagram.
 */
export interface SankeyLink {
    source: string; // ID of the source node
    target: string; // ID of the target node
    value: number;  // The flow amount
}

/**
 * Defines the complete data payload for the Cashflow Sankey visualization.
 */
export interface CashflowSankeyData {
    nodes: SankeyNode[];
    links: SankeyLink[];
}
