import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFSAContributionsService } from '../../../backend/src/features/TFSAContributions/service';
import type { IDbClient } from '../../../backend/src/infrastructure/db/IDbClient';
import { investmentConfig } from '../../../../shared/config/env.js';

// Mock the shared env config
vi.mock('../../../../shared/config/env.js', () => ({
  investmentConfig: {}
}));

describe('TFSAContributionsService', () => {
  let mockDbClient: IDbClient;
  let service: TFSAContributionsService;

  beforeEach(() => {
    mockDbClient = { query: vi.fn() };
    service = new TFSAContributionsService(mockDbClient);
    Object.assign(investmentConfig, {
      hasTFSA: false,
      tfsaTracking: [],
      tfsaYtdLimit: 7000,
      tfsa: { totalRoom: 7000 }
    });
  });

  describe('getYearToDateContributions', () => {
    it('should return empty payload if tracking is disabled', async () => {
      const result = await service.getYearToDateContributions();
      
      expect(result.hasTFSA).toBe(false);
      expect(result.ytdTotal).toBe(0);
      expect(result.categories).toHaveLength(0);
    });

    it('should aggregate contributions correctly based on configured categories', async () => {
      Object.assign(investmentConfig, {
        hasTFSA: true,
        tfsaTracking: ["Questrade TFSA", "Wealthsimple TFSA"],
        tfsaYtdLimit: 7000,
        tfsa: { totalRoom: 10000 }
      });
      
      const queryMock = mockDbClient.query as any;
      queryMock.mockResolvedValue([
        { date: '20240101', amount: -100000, category_name: 'Questrade TFSA', account_offbudget: 0, category_is_income: 0 },
        { date: '20240215', amount: -50000, category_name: 'Wealthsimple TFSA', account_offbudget: 0, category_is_income: 0 },
        { date: '20240301', amount: -20000, category_name: 'Ignored Category', account_offbudget: 0, category_is_income: 0 }
      ]);

      const result = await service.getYearToDateContributions();
      
      expect(queryMock).toHaveBeenCalledTimes(1);
      
      expect(result.hasTFSA).toBe(true);
      expect(result.ytdLimit).toBe(7000);
      expect(result.totalRoom).toBe(10000);
      expect(result.ytdTotal).toBe(1500); 
      expect(result.remainingLimit).toBe(5500);
      expect(result.progressPct).toBe(1500 / 7000);
      
      expect(result.categories).toHaveLength(2);
      expect(result.categories).toEqual(expect.arrayContaining([
        { name: 'Questrade TFSA', total: 1000 },
        { name: 'Wealthsimple TFSA', total: 500 }
      ]));
    });

    it('should ignore off-budget and income transactions', async () => {
      Object.assign(investmentConfig, {
        hasTFSA: true,
        tfsaTracking: ["Questrade TFSA"]
      });
      const queryMock = mockDbClient.query as any;
      
      queryMock.mockResolvedValue([
        { date: '20240101', amount: -100000, category_name: 'Questrade TFSA', account_offbudget: 1, category_is_income: 0 },
        { date: '20240215', amount: -50000, category_name: 'Questrade TFSA', account_offbudget: 0, category_is_income: 1 }
      ]);

      const result = await service.getYearToDateContributions();
      expect(result.ytdTotal).toBe(0);
    });
  });
});
