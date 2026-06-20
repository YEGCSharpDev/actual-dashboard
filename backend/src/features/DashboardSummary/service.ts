import { MonthlySpendingService } from '../MonthlySpending/service.js';
import { getBudgets } from '../BudgetEnvelope/service.js';
import { InvestmentProjectionsService } from '../InvestmentProjections/service.js';

import { investmentConfig } from '@shared/config/env.js';

export class DashboardSummaryService {
  public async getDashboard(month: string) {
    const monthlySpendingService = new MonthlySpendingService();
    const projectionsService = new InvestmentProjectionsService();

    const [monthlySpending, budgets, projections] = await Promise.all([
      monthlySpendingService.getMonthlySpending(month),
      getBudgets(month),
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
