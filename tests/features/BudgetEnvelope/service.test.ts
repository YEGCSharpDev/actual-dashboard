import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEnvelopeHealth } from '../../../backend/src/features/BudgetEnvelope/service';
import * as serverModule from '../../../backend/server';

// Mock the queryLocalDb function from the server module
vi.mock('../../../backend/server', () => ({
  queryLocalDb: vi.fn(),
}));

describe('BudgetEnvelope Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getEnvelopeHealth', () => {
    it('should calculate underfunded amounts for the current and two future months', async () => {
      // Setup mock implementation
      const mockQueryLocalDb = vi.mocked(serverModule.queryLocalDb);
      
      // We expect 3 calls (for month i, i+1, i+2)
      // Month 1: 50.50 underfunded
      // Month 2: 0 underfunded (fully funded)
      // Month 3: 100.00 underfunded
      mockQueryLocalDb
        .mockResolvedValueOnce([{ underfunded: 50.50 }])
        .mockResolvedValueOnce([{ underfunded: 0 }])
        .mockResolvedValueOnce([{ underfunded: 100.00 }]);

      const selectedMonth = '2024-06';
      const result = await getEnvelopeHealth(selectedMonth);

      // Verify the number of calls to the DB
      expect(mockQueryLocalDb).toHaveBeenCalledTimes(3);

      // Verify arguments for each call
      expect(mockQueryLocalDb).toHaveBeenNthCalledWith(1, expect.any(String), ['202406']);
      expect(mockQueryLocalDb).toHaveBeenNthCalledWith(2, expect.any(String), ['202407']);
      expect(mockQueryLocalDb).toHaveBeenNthCalledWith(3, expect.any(String), ['202408']);

      // Verify the result structure
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
      const mockQueryLocalDb = vi.mocked(serverModule.queryLocalDb);
      mockQueryLocalDb.mockResolvedValue([{ underfunded: 10.00 }]);

      const selectedMonth = '2024-12';
      const result = await getEnvelopeHealth(selectedMonth);

      expect(mockQueryLocalDb).toHaveBeenCalledTimes(3);
      expect(mockQueryLocalDb).toHaveBeenNthCalledWith(1, expect.any(String), ['202412']);
      expect(mockQueryLocalDb).toHaveBeenNthCalledWith(2, expect.any(String), ['202501']);
      expect(mockQueryLocalDb).toHaveBeenNthCalledWith(3, expect.any(String), ['202502']);

      expect(result[0].month).toBe('202412');
      expect(result[1].month).toBe('202501');
      expect(result[2].month).toBe('202502');
    });

    it('should handle empty result sets gracefully', async () => {
      const mockQueryLocalDb = vi.mocked(serverModule.queryLocalDb);
      // DB returning empty rows
      mockQueryLocalDb.mockResolvedValue([]);

      const result = await getEnvelopeHealth('2024-06');

      expect(result[0].underfunded).toBe(0);
      expect(result[1].underfunded).toBe(0);
      expect(result[2].underfunded).toBe(0);
    });

    it('should handle null values from the sum gracefully', async () => {
      const mockQueryLocalDb = vi.mocked(serverModule.queryLocalDb);
      // DB returning null from the COALESCE / sum if something is weird
      mockQueryLocalDb.mockResolvedValue([{ underfunded: null }]);

      const result = await getEnvelopeHealth('2024-06');

      expect(result[0].underfunded).toBe(0);
      expect(result[1].underfunded).toBe(0);
      expect(result[2].underfunded).toBe(0);
    });
  });
});
