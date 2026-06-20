import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonthlySpendingService } from '../../../backend/src/features/MonthlySpending/service';
import * as serverModule from '../../../backend/server';

vi.mock('../../../backend/server', () => ({
  queryLocalDb: vi.fn(),
}));

describe('MonthlySpendingService', () => {
  let service: MonthlySpendingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MonthlySpendingService();
  });

  describe('getMonthlySpending', () => {
    it('should aggregate income and expenses correctly', async () => {
      const mockQueryLocalDb = vi.mocked(serverModule.queryLocalDb);
      
      // Amount in DB is in cents.
      // Outflows (expenses) are negative, inflows (income) are positive.
      mockQueryLocalDb.mockResolvedValue([
        {
          id: '1',
          amount: 50000, // $500 income
          account_offbudget: 0,
          transfer_account_name: null,
          category_name: 'Salary',
          category_is_income: 1
        },
        {
          id: '2',
          amount: -15000, // $150 expense
          account_offbudget: 0,
          transfer_account_name: null,
          category_name: 'Groceries',
          category_is_income: 0
        },
        {
          id: '3',
          amount: -5000, // $50 expense
          account_offbudget: 0,
          transfer_account_name: null,
          category_name: 'Utilities',
          category_is_income: 0
        }
      ]);

      const result = await service.getMonthlySpending('2024-06');

      expect(mockQueryLocalDb).toHaveBeenCalledTimes(1);
      expect(mockQueryLocalDb).toHaveBeenCalledWith(expect.any(String), ['202406%']);

      expect(result.totalIncome).toBe(500);
      expect(result.totalSpent).toBe(200);
      expect(result.netIncome).toBe(300);
      expect(result.savingsRate).toBe(60);

      expect(result.income).toHaveLength(1);
      expect(result.income[0]).toEqual({ Category_Name: 'Salary', amount: 500 });

      expect(result.expenses).toHaveLength(2);
      expect(result.expenses).toEqual(expect.arrayContaining([
        { Category_Name: 'Groceries', amount: 150 },
        { Category_Name: 'Utilities', amount: 50 }
      ]));
    });

    it('should handle transfers as Account Transfer', async () => {
      const mockQueryLocalDb = vi.mocked(serverModule.queryLocalDb);
      
      mockQueryLocalDb.mockResolvedValue([
        {
          id: '1',
          amount: -10000, // $100 outflow
          account_offbudget: 0,
          transfer_account_name: 'Savings',
          category_name: null,
          category_is_income: 0
        }
      ]);

      const result = await service.getMonthlySpending('2024-06');

      expect(result.expenses).toHaveLength(1);
      expect(result.expenses[0]).toEqual({ Category_Name: 'Account Transfer', amount: 100 });
    });

    it('should handle empty transactions gracefully', async () => {
      const mockQueryLocalDb = vi.mocked(serverModule.queryLocalDb);
      mockQueryLocalDb.mockResolvedValue([]);

      const result = await service.getMonthlySpending('2024-06');

      expect(result.totalIncome).toBe(0);
      expect(result.totalSpent).toBe(0);
      expect(result.netIncome).toBe(0);
      expect(result.savingsRate).toBe(0);
      expect(result.income).toHaveLength(0);
      expect(result.expenses).toHaveLength(0);
    });

    it('should exclude zero amount categories', async () => {
      const mockQueryLocalDb = vi.mocked(serverModule.queryLocalDb);
      mockQueryLocalDb.mockResolvedValue([
        {
          id: '1',
          amount: 0, 
          account_offbudget: 0,
          transfer_account_name: null,
          category_name: 'Zero Expense',
          category_is_income: 0
        }
      ]);

      const result = await service.getMonthlySpending('2024-06');
      expect(result.expenses).toHaveLength(0);
    });
  });
});
