/**
 * @file backend/server.ts
 * @description Main server entry point for the Actual Budget Dashboard API.
 * Initializes the connection to the Actual API, runs database syncs, and exposes 
 * global routes (like backups and monolithic legacy queries) alongside modular Vertical Slice routers.
 */
import './navigator-polyfill.js';
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { getDbPath, queryLocalDb, resetDbConnection } from './src/db/client.js';

// @ts-ignore
import api from '@actual-app/api';
import AdmZip from 'adm-zip';

import { parseMathInput } from '../shared/features/SafeMath/index.js';
import { featureRouters } from './src/features/index.js';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.ACTUAL_DATA_DIR || path.join(process.cwd(), '.actual-data');

const syncState = {
  syncPromise: null as Promise<void> | null,
  syncError: null as string | null,
  lastSyncTime: null as Date | null,
};

// Actual Sync logic
async function _doSyncInternal(): Promise<void> {
  syncState.syncError = null;

  const serverUrl = process.env.ACTUAL_SERVER_URL;
  const password = process.env.ACTUAL_PASSWORD;
  const syncId = process.env.ACTUAL_SYNC_ID;
  const encryptionPassword = process.env.ACTUAL_ENCRYPTION_PASSWORD;

  if (!serverUrl || !password || !syncId) {
    syncState.syncError = "Missing ACTUAL_SERVER_URL, ACTUAL_PASSWORD, or ACTUAL_SYNC_ID env variables";
    console.error(syncState.syncError);
    return;
  }

  try {
    resetDbConnection();

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    console.log("Initializing Actual API...");
    await api.init({
      dataDir: DATA_DIR,
      serverURL: serverUrl,
      password: password,
    });

    console.log("Downloading budget...");
    await api.downloadBudget(syncId, { password: encryptionPassword });

    console.log("Syncing database...");
    await api.sync();

    await api.shutdown();
    
    syncState.lastSyncTime = new Date();
    resetDbConnection(); // Invalidate cache and connections in case path changed
    console.log("Sync completed successfully!");
  } catch (err: any) {
    syncState.syncError = err.message || String(err);
    console.error("Sync failed:", syncState.syncError);
    
    // Future-proofing: Auto-detect schema mismatch and update the API client
    if (syncState.syncError && (syncState.syncError.includes('invalid-schema') || syncState.syncError.includes('no such column'))) {
      console.error("===============================================================");
      console.error("FATAL: Schema conflict detected with the Actual Budget server.");
      console.error("Attempting to auto-heal by updating @actual-app/api to latest...");
      console.error("===============================================================");
      try {
        const { execSync } = await import('child_process');
        execSync('npm install @actual-app/api@latest', { stdio: 'inherit' });
        console.error("Successfully updated @actual-app/api. Restarting server...");
        process.exit(1); // Exit to allow process manager/Docker to restart the service with the new package
      } catch (updateErr) {
        console.error("Failed to auto-update @actual-app/api. Please run 'npm install @actual-app/api@latest' manually.", updateErr);
      }
    }

    try {
      await api.shutdown();
    } catch (e) {}
  }
}

function doSync(): Promise<void> {
  if (syncState.syncPromise) return syncState.syncPromise;
  syncState.syncPromise = _doSyncInternal().finally(() => { 
    syncState.syncPromise = null; 
  });
  return syncState.syncPromise;
}

// Start periodic sync (every 15 minutes)
function startPeriodicSync() {
  doSync();
  setInterval(doSync, 15 * 60 * 1000);
}

import { runBackup } from './src/features/Backup/service.js';

let lastBackupDateString = '';

// Start backup scheduler checking every 30 seconds
function startBackupScheduler() {
  setInterval(() => {
    const now = new Date();
    const dateString = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    
    // Check if it is 8:00 PM (20:00) and we haven't backed up today yet
    if (now.getHours() === 20 && lastBackupDateString !== dateString) {
      lastBackupDateString = dateString;
      runBackup()
        .then(filename => console.log(`[Scheduler] Automatic 8PM backup completed: ${filename}`))
        .catch(err => console.error('[Scheduler] Automatic 8PM backup failed:', err));
    }
  }, 30000);
}

// Math expression evaluator (safe)


// API Routes
app.get('/api/status', (req, res) => {
  res.json({
    isSyncing: !!syncState.syncPromise,
    syncError: syncState.syncError,
    lastSyncTime: syncState.lastSyncTime ? syncState.lastSyncTime.toISOString() : null,
  });
});

app.post('/api/sync', async (req, res) => {
  if (syncState.syncPromise) {
    return res.status(409).json({ error: "Sync is already in progress" });
  }
  await doSync();
  if (syncState.syncError) {
    res.status(500).json({ error: syncState.syncError });
  } else {
    res.json({ success: true, lastSyncTime: syncState.lastSyncTime });
  }
});

app.post('/api/evaluate', (req, res) => {
  const { expr } = req.body;
  if (typeof expr !== 'string') {
    return res.status(400).json({ error: "Expression must be a string" });
  }
  const result = parseMathInput(expr);
  res.json({ result });
});



// /api/data endpoint has been removed. Use vertical slice API endpoints (e.g. /api/dashboard) instead.

// ==========================================
// Vertical Slice Architecture Feature Routes
// ==========================================
//
// In VSA, instead of keeping all API routes in this monolithic server.ts file,
// routes are grouped inside their respective feature folders:
// backend/src/features/[FeatureName]/router.ts
//
// The loop below automatically registers those feature-based routers
// exported from backend/src/features/index.ts, dynamically prefixing them with `/api`.
//
// To register a new feature route:
// 1. Implement the Express router in your feature's router.ts file.
// 2. Register it in backend/src/features/index.ts.
//
Object.entries(featureRouters).forEach(([pathName, router]) => {
  const apiPath = `/api${pathName}`;
  console.log(`[VSA Infrastructure] Dynamically mounting feature router: ${apiPath}`);
  app.use(apiPath, router);
});

import { globalErrorHandler } from './src/shared/middleware/errorHandler.js';
app.use(globalErrorHandler);

// Serve static frontend files in production
const frontendDistPath = path.join(process.cwd(), 'frontend', 'dist');
if (fs.existsSync(frontendDistPath)) {
  console.log(`Serving static frontend from ${frontendDistPath}`);
  app.use(express.static(frontendDistPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendDistPath, 'index.html'));
  });
} else {
  console.warn(`Static frontend build path ${frontendDistPath} not found. Running in API-only mode.`);
}

if (process.env.BACKEND_NO_LISTEN !== 'true' && process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    startPeriodicSync();
    startBackupScheduler();
  });
}
