/**
 * @file backend/src/features/index.ts
 * @description Central registry and mounting mechanism for all feature slices
 * in the Vertical Slice Architecture (VSA).
 * 
 * To add a new feature to the actual-dashboard application:
 * 1. Create a new directory under `backend/src/features/[FeatureName]`.
 * 2. Implement the business logic in `service.ts` and the Express router in `router.ts`.
 * 3. Export the Express router from your feature slice.
 * 4. Register the feature path and router in the `featureRouters` map below.
 * 
 * Example:
 * ```typescript
 * import { monthlySpendingRouter } from './MonthlySpending/router';
 * ...
 * export const featureRouters: Record<string, Router> = {
 *   '/monthly-spending': monthlySpendingRouter,
 * };
 * ```
 */

import { Router } from 'express';
import { monthlySpendingRouter } from './MonthlySpending/router';

// Feature routers will be imported and registered here as we refactor each horizontal concern.

/**
 * Map of feature-based routes to their respective Express Routers.
 * The keys represent the base sub-path (e.g., '/monthly-spending') which will
 * be prefixed under `/api` (e.g., `/api/monthly-spending`).
 */
export const featureRouters: Record<string, Router> = {
  '/monthly-spending': monthlySpendingRouter,
};
