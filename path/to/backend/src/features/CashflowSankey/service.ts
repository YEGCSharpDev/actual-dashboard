// backend/src/features/CashflowSankey/service.ts
/**
 * Service layer for handling all business logic related to Cashflow Sankey data generation.
 * This layer abstracts the data processing from the API layer.
 */

import { CashflowTransaction, CashflowSankeyData } from "../../../shared/types/CashflowSankey";

/**
 * Service class responsible for processing raw transactions into Sankey diagram data.
 */
export class CashflowSankeyService {

    /**
     * Processes a list of transactions to calculate the necessary nodes and links for the Sankey diagram.
     * This is the core data-munging logic.
     * @param transactions An array of CashflowTransaction objects.
     * @returns The structured data required for the Sankey visualization.
     */
    public calculateSankeyData(transactions: CashflowTransaction[]): CashflowSankeyData {
        // 1. Identify unique income and expense categories (Nodes)
        const incomeNodes = new Map<string, SankeyNode>();
        const expenseNodes = new Map<string, SankeyNode>();
        
        // Initialize nodes based on transaction types
        transactions.forEach(tx => {
            if (tx.type === 'income') {
                const nodeId = `income_${tx.month}`;
                if (!incomeNodes.has(nodeId)) {
                    income.add(node);
                    node.label = `Income (${node.id})`;
                }
            } else if (node.id) {
                // Ensure we have a unique ID for expense nodes
                if (!expense.has(node.id)) {
                    expense.add(node.id);
                    node.label = `Expense (${node.id})`;
                }
            }
        }

        // 2. Calculate total flows (simplified for this example)
        const totalIncome = Array.from(income.values()).reduce((sum, node) => sum + (node.id ? 1000 : 0), 0);
        const totalExpense = Array.from(expense.values()).reduce((sum, id) => sum + 500, 0);

        // 3. Create the flow link
        const flow = {
            source: 'Income',
            target: 'Expense',
            value: totalIncome - totalExpense,
        };

        // 4. Return the structured data
        return {
            nodes: Array.from(income.values()).concat(Array.from(expense.values())),
            links: [flow]
        };
    }
}

// Mock implementation for demonstration purposes
const income = new Map();
const expense = new Set();
income.add({ id: 'Income', label: 'Total Income' });
expense.add('Expense_1');
