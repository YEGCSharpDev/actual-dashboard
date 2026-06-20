/**
 * @file backend/src/features/MonthlySpending/service.ts
 * @description Service containing the business logic and database queries for
 * retrieving monthly spending and income aggregates.
 */

import type { IDbClient } from '../../infrastructure/db/IDbClient.js';
import { defaultDbClient } from '../../db/client.js';
import type { MonthlySpendingPayload } from '@shared/types/MonthlySpending';
import { getMonthlySpending } from '../../shared/queries/getMonthlySpending.js';

export class MonthlySpendingService {
  constructor(private db: IDbClient = defaultDbClient) {}

  public async getMonthlySpending(selectedMonth: string): Promise<MonthlySpendingPayload> {
    return getMonthlySpending(this.db, selectedMonth);
  }
}
