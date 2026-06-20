import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CashflowSankeyService } from '../../../backend/src/features/CashflowSankey/service';
import type { IDbClient } from '../../../backend/src/infrastructure/db/IDbClient';

// Mock the shared getMonthlySpending query
vi.mock('../../../backend/src/shared/queries/getMonthlySpending.js', () => ({
  getMonthlySpending: vi.fn()
}));

import { getMonthlySpending } from '../../../backend/src/shared/queries/getMonthlySpending.js';

describe('CashflowSankeyService', () => {
  let mockDbClient: IDbClient;
  let service: CashflowSankeyService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbClient = { query: vi.fn() };
    service = new CashflowSankeyService(mockDbClient);
  });

  describe('getSankeyData', () => {
    it('should generate nodes and links correctly', async () => {
      const queryMock = vi.mocked(getMonthlySpending);
      queryMock.mockResolvedValue({
        income: [{ Category_Name: 'Salary', amount: 5000 }],
        expenses: [{ Category_Name: 'Rent', amount: 2000 }, { Category_Name: 'Food', amount: 1000 }],
        totalIncome: 5000,
        totalSpent: 3000,
        netIncome: 2000,
        savingsRate: 40,
        transactions: []
      });

      const result = await service.getSankeyData('2024-06');

      expect(queryMock).toHaveBeenCalledWith(mockDbClient, '2024-06');
      
      expect(result.nodes.length).toBeGreaterThan(0);
      expect(result.links.length).toBeGreaterThan(0);

      // Verify specific nodes
      const labels = result.nodes.map((n: any) => n.label);
      expect(labels).toContain('Salary');
      expect(labels).toContain('Monthly Cashflow');
      expect(labels).toContain('Total Expenses');
      expect(labels).toContain('Savings (Net Income)');
      expect(labels).toContain('Rent');
      expect(labels).toContain('Food');

      // Net income is positive, so no Deficit node
      expect(labels).not.toContain('Overspending (Deficit)');
    });

    it('should include Deficit node when expenses > income', async () => {
      const queryMock = vi.mocked(getMonthlySpending);
      queryMock.mockResolvedValue({
        income: [{ Category_Name: 'Salary', amount: 2000 }],
        expenses: [{ Category_Name: 'Rent', amount: 3000 }],
        totalIncome: 2000,
        totalSpent: 3000,
        netIncome: -1000,
        savingsRate: 0,
        transactions: []
      });

      const result = await service.getSankeyData('2024-06');
      const labels = result.nodes.map((n: any) => n.label);

      expect(labels).toContain('Salary');
      expect(labels).toContain('Overspending (Deficit)');
      expect(labels).toContain('Total Expenses');
      expect(labels).not.toContain('Savings (Net Income)');
    });

    it('should return empty payload if no active income or expenses', async () => {
      const queryMock = vi.mocked(getMonthlySpending);
      queryMock.mockResolvedValue({
        income: [],
        expenses: [],
        totalIncome: 0,
        totalSpent: 0,
        netIncome: 0,
        savingsRate: 0,
        transactions: []
      });

      const result = await service.getSankeyData('2024-06');

      expect(result.nodes).toHaveLength(0);
      expect(result.links).toHaveLength(0);
    });
  });
});
