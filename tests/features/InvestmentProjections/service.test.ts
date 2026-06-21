import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InvestmentProjectionsService } from '../../../backend/src/features/InvestmentProjections/service';
import type { IDbClient } from '../../../backend/src/infrastructure/db/IDbClient';
import { investmentConfig } from '../../../../shared/config/env.js';

// Mock the shared env config
vi.mock('../../../../shared/config/env.js', () => ({
  investmentConfig: {}
}));

describe('InvestmentProjectionsService', () => {
  let mockDbClient: IDbClient;
  let service: InvestmentProjectionsService;

  beforeEach(() => {
    mockDbClient = { query: vi.fn() };
    service = new InvestmentProjectionsService(mockDbClient);
    Object.assign(investmentConfig, {
      hasInvestments: false,
      hasRESP: false,
      hasTFSA: false,
      hasRRSP: false,
      resp: { identifier: 'RESP', horizonYears: 10, defaultReturnPct: 4, annualContribution: 0 },
      tfsa: { 
        horizonYears: 30, totalRoom: 7000, 
        base: { identifier: '', defaultReturnPct: 4, monthlyContribution: 0 },
        catchup: { identifier: '', defaultReturnPct: 8, catchupYearContribution: 0 }
      },
      rrsp: { identifier: 'RRSP', horizonYears: 30, defaultReturnPct: 8, annualContribution: 0 }
    });
  });

  describe('generateStandardProjection', () => {
    it('should project balances correctly with compound interest', () => {
      const accountDict = { 'My RRSP': 10000 };
      const config = {
        identifier: 'RRSP',
        horizonYears: 2,
        defaultReturnPct: 10,
        annualContribution: 1000
      };

      const result = service.generateStandardProjection(accountDict, config);

      expect(result.years).toHaveLength(3);
      expect(result.forecastData['My RRSP']).toHaveLength(3);
      expect(result.forecastData['My RRSP'][0]).toBeCloseTo(10000);
      expect(result.forecastData['My RRSP'][1]).toBeCloseTo(12000);
      expect(result.forecastData['My RRSP'][2]).toBeCloseTo(14200);
      expect(result.totalCurrent).toBe(10000);
      expect(result.totalHalfway).toBeCloseTo(12000);
      expect(result.totalFinal).toBeCloseTo(14200);
    });
  });

  describe('generateTFSAProjection', () => {
    it('should apply catchup rules appropriately', () => {
      const accountDict = { 'Base TFSA': 5000, 'Wealthsimple Catchup': 1000 };
      const config = {
        horizonYears: 2,
        totalRoom: 7000,
        base: { identifier: 'Base', defaultReturnPct: 5, monthlyContribution: 100 },
        catchup: { identifier: 'Wealthsimple Catchup', defaultReturnPct: 10, catchupYearContribution: 5000 }
      };

      const result = service.generateTFSAProjection(accountDict, config as any);

      expect(result.forecastData['Base TFSA'][0]).toBeCloseTo(5000);
      expect(result.forecastData['Base TFSA'][1]).toBeCloseTo(6450);
      expect(result.forecastData['Base TFSA'][2]).toBeCloseTo(7972.5);

      expect(result.forecastData['Wealthsimple Catchup'][0]).toBeCloseTo(1000);
      expect(result.forecastData['Wealthsimple Catchup'][1]).toBeCloseTo(6100);
      expect(result.forecastData['Wealthsimple Catchup'][2]).toBeCloseTo(12510);
    });
  });

  describe('getProjectionsData', () => {
    it('should fetch accounts and generate projections if configured', async () => {
      Object.assign(investmentConfig, {
        hasInvestments: true,
        hasRESP: true,
        hasTFSA: true,
        resp: { identifier: 'RESP', horizonYears: 5, defaultReturnPct: 4, annualContribution: 0 },
        tfsa: {
          horizonYears: 30, totalRoom: 7000,
          base: { identifier: 'TFSA', defaultReturnPct: 4, monthlyContribution: 0 },
          catchup: { identifier: '', defaultReturnPct: 8, catchupYearContribution: 0 }
        }
      });
      
      const queryMock = mockDbClient.query as any;
      queryMock.mockResolvedValue([
        { id: '1', name: 'Kids RESP', offbudget: 1, closed: 0, balance_current: 500000 },
        { id: '2', name: 'My TFSA', offbudget: 1, closed: 0, balance_current: 1000000 },
        { id: '3', name: 'Checking', offbudget: 0, closed: 0, balance_current: 200000 }
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
