import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFSAContributionsService } from '../../../backend/src/features/TFSAContributions/service';
import * as serverModule from '../../../backend/server';

vi.mock('../../../backend/server', () => ({
  queryLocalDb: vi.fn(),
}));

describe('TFSAContributionsService', () => {
  let service: TFSAContributionsService;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TFSAContributionsService();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getYearToDateContributions', () => {
    it('should return empty payload if tracking is disabled', async () => {
      // Mock tracking env variable as empty
      process.env.ACTUAL_TFSA_TRACKING = '';
      
      const result = await service.getYearToDateContributions();
      
      expect(result.hasTFSA).toBe(false);
      expect(result.ytdTotal).toBe(0);
      expect(result.categories).toHaveLength(0);
    });

    it('should aggregate contributions correctly based on configured categories', async () => {
      // Configure tracking categories
      process.env.ACTUAL_TFSA_TRACKING = '["Questrade TFSA", "Wealthsimple TFSA"]';
      process.env.ACTUAL_TFSA_YTD_LIMIT = '7000';
      process.env.ACTUAL_TFSA_TOTAL_ROOM = '10000';
      
      const mockQueryLocalDb = vi.mocked(serverModule.queryLocalDb);
      
      // Amount in DB is in cents. Outflow positive logic: amount / -100.
      // So -100000 cents = $1000 outflow.
      mockQueryLocalDb.mockResolvedValue([
        {
          date: '20240101',
          amount: -100000, // $1000
          category_name: 'Questrade TFSA',
          account_offbudget: 0,
          category_is_income: 0
        },
        {
          date: '20240215',
          amount: -50000, // $500
          category_name: 'Wealthsimple TFSA',
          account_offbudget: 0,
          category_is_income: 0
        },
        {
          date: '20240301',
          amount: -20000, // $200
          category_name: 'Ignored Category',
          account_offbudget: 0,
          category_is_income: 0
        }
      ]);

      const result = await service.getYearToDateContributions();
      
      expect(mockQueryLocalDb).toHaveBeenCalledTimes(1);
      
      expect(result.hasTFSA).toBe(true);
      expect(result.ytdLimit).toBe(7000);
      expect(result.totalRoom).toBe(10000);
      expect(result.ytdTotal).toBe(1500); // 1000 + 500
      expect(result.remainingLimit).toBe(5500);
      expect(result.progressPct).toBe(1500 / 7000);
      
      expect(result.categories).toHaveLength(2);
      expect(result.categories).toEqual(expect.arrayContaining([
        { name: 'Questrade TFSA', total: 1000 },
        { name: 'Wealthsimple TFSA', total: 500 }
      ]));

      expect(result.velocityChart).not.toBeNull();
      if (result.velocityChart) {
        expect(result.velocityChart.datasets).toHaveLength(2); // One per category
      }
    });

    it('should ignore off-budget and income transactions', async () => {
      process.env.ACTUAL_TFSA_TRACKING = '["Questrade TFSA"]';
      const mockQueryLocalDb = vi.mocked(serverModule.queryLocalDb);
      
      mockQueryLocalDb.mockResolvedValue([
        {
          date: '20240101',
          amount: -100000, // $1000
          category_name: 'Questrade TFSA',
          account_offbudget: 1, // Ignore: offbudget
          category_is_income: 0
        },
        {
          date: '20240215',
          amount: -50000, // $500
          category_name: 'Questrade TFSA',
          account_offbudget: 0, 
          category_is_income: 1 // Ignore: income
        }
      ]);

      const result = await service.getYearToDateContributions();
      expect(result.ytdTotal).toBe(0);
    });
  });
});
