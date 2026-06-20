import { MonthlySpendingService } from '../MonthlySpending/service.js';
import { getBudgets } from '../BudgetEnvelope/service.js';
import { InvestmentProjectionsService } from '../InvestmentProjections/service.js';

export class DashboardSummaryService {
  public async getDashboard(month: string) {
    const monthlySpendingService = new MonthlySpendingService();
    const projectionsService = new InvestmentProjectionsService();

    const [monthlySpending, budgets, projections] = await Promise.all([
      monthlySpendingService.getMonthlySpending(month),
      getBudgets(month),
      projectionsService.getProjectionsData()
    ]);

    const parseJsonEnvArray = (val: string | undefined): string[] => {
      if (!val) return [];
      const clean = val.trim().replace(/^['"]|['"]$/g, '');
      try {
        return JSON.parse(clean);
      } catch (err) {
        console.error(`Failed to parse JSON env array: "${val}"`, err);
        return [];
      }
    };

    const config = {
      categories: {
        tfsa_tracking: parseJsonEnvArray(process.env.ACTUAL_TFSA_TRACKING),
        budget_tracking: parseJsonEnvArray(process.env.ACTUAL_BUDGET_TRACKING),
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
