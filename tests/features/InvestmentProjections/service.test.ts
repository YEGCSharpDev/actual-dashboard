import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InvestmentProjectionsService } from '../../../backend/src/features/InvestmentProjections/service';
import * as serverModule from '../../../backend/server';

vi.mock('../../../backend/server', () => ({
  queryLocalDb: vi.fn(),
}));

describe('InvestmentProjectionsService', () => {
  let service: InvestmentProjectionsService;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new InvestmentProjectionsService();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('generateStandardProjection', () => {
    it('should project balances correctly with compound interest', () => {
      const accountDict = { 'My RRSP': 10000 };
      const config = {
        identifier: 'RRSP',
        horizonYears: 2,
        defaultReturnPct: 10, // 10%
        annualContribution: 1000
      };

      const result = service.generateStandardProjection(accountDict, config);

      expect(result.years).toHaveLength(3); // Year 0, 1, 2
      expect(result.forecastData['My RRSP']).toHaveLength(3);

      // Year 0: 10000
      // Year 1: 10000 * 1.1 + 1000 = 12000
      // Year 2: 12000 * 1.1 + 1000 = 14200
      expect(result.forecastData['My RRSP'][0]).toBeCloseTo(10000);
      expect(result.forecastData['My RRSP'][1]).toBeCloseTo(12000);
      expect(result.forecastData['My RRSP'][2]).toBeCloseTo(14200);

      expect(result.totalCurrent).toBe(10000);
      expect(result.totalHalfway).toBeCloseTo(12000); // 2/2 = 1 -> index 1
      expect(result.totalFinal).toBeCloseTo(14200);
    });
  });

  describe('generateTFSAProjection', () => {
    it('should apply catchup rules appropriately', () => {
      const accountDict = { 'Base TFSA': 5000, 'Wealthsimple Catchup': 1000 };
      const config = {
        horizonYears: 2,
        totalRoom: 7000,
        base: {
          identifier: 'Base',
          defaultReturnPct: 5,
          monthlyContribution: 100 // 1200 annual
        },
        catchup: {
          identifier: 'Wealthsimple Catchup',
          defaultReturnPct: 10,
          catchupYearContribution: 5000
        }
      };

      const result = service.generateTFSAProjection(accountDict, config as any);

      // Base TFSA (Year 0: 5000)
      // Year 1: 5000 * 1.05 + 1200 = 6450
      // Year 2: 6450 * 1.05 + 1200 = 7972.5
      expect(result.forecastData['Base TFSA'][0]).toBeCloseTo(5000);
      expect(result.forecastData['Base TFSA'][1]).toBeCloseTo(6450);
      expect(result.forecastData['Base TFSA'][2]).toBeCloseTo(7972.5);

      // Catchup TFSA (Year 0: 1000)
      // Year 1: 1000 * 1.1 + 5000 = 6100 (catchupYearContribution)
      // Year 2: 6100 * 1.1 + 5800 = 12510 (totalRoom 7000 - 1200 = 5800 future annual)
      expect(result.forecastData['Wealthsimple Catchup'][0]).toBeCloseTo(1000);
      expect(result.forecastData['Wealthsimple Catchup'][1]).toBeCloseTo(6100);
      expect(result.forecastData['Wealthsimple Catchup'][2]).toBeCloseTo(12510);
    });
  });

  describe('getProjectionsData', () => {
    it('should fetch accounts and generate projections if configured', async () => {
      process.env.ACTUAL_RESP_IDENTIFIER = 'RESP';
      process.env.ACTUAL_RESP_HORIZON_YEARS = '5';
      process.env.ACTUAL_TFSA_TRACKING = 'true'; // trigger TFSA
      
      const mockQueryLocalDb = vi.mocked(serverModule.queryLocalDb);
      mockQueryLocalDb.mockResolvedValue([
        {
          id: '1', name: 'Kids RESP', offbudget: 1, closed: 0, balance_current: 500000 // $5000
        },
        {
          id: '2', name: 'My TFSA', offbudget: 1, closed: 0, balance_current: 1000000 // $10000
        },
        {
          id: '3', name: 'Checking', offbudget: 0, closed: 0, balance_current: 200000 // on-budget, ignored
        }
      ]);

      const result = await service.getProjectionsData();

      expect(result.hasRESP).toBe(true);
      expect(result.hasTFSA).toBe(true);
      expect(result.respBalances['Kids RESP']).toBe(5000);
      expect(result.tfsaBalances['My TFSA']).toBe(10000);
      
      expect(result.respProjection).not.toBeNull();
      expect(result.tfsaProjection).not.toBeNull();
    });
  });
});
