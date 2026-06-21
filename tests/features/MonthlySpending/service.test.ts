import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MonthlySpendingService } from '../../../backend/src/features/MonthlySpending/service';
import type { IDbClient } from '../../../backend/src/infrastructure/db/IDbClient';

describe('MonthlySpendingService', () => {
  let mockDbClient: IDbClient;
  let service: MonthlySpendingService;

  beforeEach(() => {
    mockDbClient = { query: vi.fn() };
    service = new MonthlySpendingService(mockDbClient);
  });

  describe('getMonthlySpending', () => {
    it('should aggregate income and expenses correctly', async () => {
      const queryMock = mockDbClient.query as any;
      
      // Amount in DB is in cents.
      // Outflows (expenses) are negative, inflows (income) are positive.
      queryMock.mockResolvedValue([
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

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(queryMock).toHaveBeenCalledWith(expect.any(String), ['202406%']);

      expect(result.totalIncome).toBe(500);
      expect(result.totalSpent).toBe(200);
      expect(result.netIncome).toBe(300);
      expect(result.savingsRate).toBe(60);

      expect(result.income).toHaveLength(1);
      expect(result.income[0]).toEqual({ categoryName: 'Salary', amount: 500 });

      expect(result.expenses).toHaveLength(2);
      expect(result.expenses).toEqual(expect.arrayContaining([
        { categoryName: 'Groceries', amount: 150 },
        { categoryName: 'Utilities', amount: 50 }
      ]));
    });

    it('should handle transfers as Account Transfer', async () => {
      const queryMock = mockDbClient.query as any;
      
      queryMock.mockResolvedValue([
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
      expect(result.expenses[0]).toEqual({ categoryName: 'Account Transfer', amount: 100 });
    });

    it('should handle empty transactions gracefully', async () => {
      const queryMock = mockDbClient.query as any;
      queryMock.mockResolvedValue([]);

      const result = await service.getMonthlySpending('2024-06');

      expect(result.totalIncome).toBe(0);
      expect(result.totalSpent).toBe(0);
      expect(result.netIncome).toBe(0);
      expect(result.savingsRate).toBe(0);
      expect(result.income).toHaveLength(0);
      expect(result.expenses).toHaveLength(0);
    });

    it('should exclude zero amount categories', async () => {
      const queryMock = mockDbClient.query as any;
      queryMock.mockResolvedValue([
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
