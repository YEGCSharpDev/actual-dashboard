/**
 * @file shared/types/index.ts
 * @description Entry point for shared TypeScript types and interfaces between
 * the backend and the frontend in the Vertical Slice Architecture.
 */

/**
 * Basic health status interface to verify connection and sync state.
 */
export interface SystemStatus {
  /** Indicates if a sync process with the Actual Budget API is active */
  isSyncing: boolean;
  /** Holds the error message if the last sync failed, or null if successful */
  syncError: string | null;
  /** ISO timestamp string of the last successful sync, or null if never synced */
  lastSyncTime: string | null;
}
