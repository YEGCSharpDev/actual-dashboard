import { MonthlySpendingService } from '../MonthlySpending/service.js';
import { BudgetEnvelopeService } from '../BudgetEnvelope/service.js';
import { InvestmentProjectionsService } from '../InvestmentProjections/service.js';
import type { IDbClient } from '../../infrastructure/db/IDbClient.js';
import { defaultDbClient } from '../../db/client.js';

import { investmentConfig } from '../../../../shared/config/env.js';

export class DashboardSummaryService {
  constructor(private db: IDbClient = defaultDbClient) {}

  public async getDashboard(month: string) {
    const monthlySpendingService = new MonthlySpendingService(this.db);
    const projectionsService = new InvestmentProjectionsService(this.db);
    const budgetEnvelopeService = new BudgetEnvelopeService(this.db);

    const [monthlySpending, budgets, projections] = await Promise.all([
      monthlySpendingService.getMonthlySpending(month),
      budgetEnvelopeService.getBudgets(month),
      projectionsService.getProjectionsData()
    ]);

    const config = {
      categories: {
        tfsa_tracking: investmentConfig.tfsaTracking,
        budget_tracking: investmentConfig.budgetTracking,
      },
      hasInvestments: projections.hasInvestments,
      hasRESP: projections.hasRESP,
      hasRRSP: projections.hasRRSP,
      hasTFSA: projections.hasTFSA,
      resp: projections.respConfig,
      rrsp: projections.rrspConfig,
      tfsa: projections.tfsaConfig,
    };

    return {
      transactions: monthlySpending.transactions,
      budgets,
      config,
      error: null
    };
  }
}
