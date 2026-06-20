import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BudgetEnvelopeService } from '../../../backend/src/features/BudgetEnvelope/service';
import type { IDbClient } from '../../../backend/src/infrastructure/db/IDbClient';

describe('BudgetEnvelope Service', () => {
  let mockDbClient: IDbClient;
  let service: BudgetEnvelopeService;

  beforeEach(() => {
    mockDbClient = {
      query: vi.fn()
    };
    service = new BudgetEnvelopeService(mockDbClient);
  });

  describe('getEnvelopeHealth', () => {
    it('should calculate underfunded amounts for the current and two future months', async () => {
      const queryMock = mockDbClient.query as any;
      queryMock.mockResolvedValueOnce([
        { month: '202406', underfunded: 50.50 },
        { month: '202408', underfunded: 100.00 }
      ]);

      const selectedMonth = '2024-06';
      const result = await service.getEnvelopeHealth(selectedMonth);

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(queryMock).toHaveBeenCalledWith(expect.any(String), ['202406', '202407', '202408']);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({
        month: '202406',
        underfunded: 50.50,
        overbudget: 0,
        underbudget: 0,
      });
      expect(result[1]).toEqual({
        month: '202407',
        underfunded: 0,
        overbudget: 0,
        underbudget: 0,
      });
      expect(result[2]).toEqual({
        month: '202408',
        underfunded: 100.00,
        overbudget: 0,
        underbudget: 0,
      });
    });

    it('should handle December to January rollover correctly', async () => {
      const queryMock = mockDbClient.query as any;
      queryMock.mockResolvedValue([{ month: '202412', underfunded: 10.00 }]);

      const selectedMonth = '2024-12';
      const result = await service.getEnvelopeHealth(selectedMonth);

      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(queryMock).toHaveBeenCalledWith(expect.any(String), ['202412', '202501', '202502']);

      expect(result[0].month).toBe('202412');
      expect(result[1].month).toBe('202501');
      expect(result[2].month).toBe('202502');
    });

    it('should handle empty result sets gracefully', async () => {
      const queryMock = mockDbClient.query as any;
      queryMock.mockResolvedValue([]);

      const result = await service.getEnvelopeHealth('2024-06');

      expect(result[0].underfunded).toBe(0);
      expect(result[1].underfunded).toBe(0);
      expect(result[2].underfunded).toBe(0);
    });

    it('should handle null values from the sum gracefully', async () => {
      const queryMock = mockDbClient.query as any;
      queryMock.mockResolvedValue([{ underfunded: null }]);

      const result = await service.getEnvelopeHealth('2024-06');

      expect(result[0].underfunded).toBe(0);
      expect(result[1].underfunded).toBe(0);
      expect(result[2].underfunded).toBe(0);
    });
  });
});
