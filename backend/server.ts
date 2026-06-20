/**
 * @file backend/server.ts
 * @description Main server entry point for the Actual Budget Dashboard API.
 * Initializes the connection to the Actual API, runs database syncs, and exposes 
 * global routes (like backups and monolithic legacy queries) alongside modular Vertical Slice routers.
 */
import './navigator-polyfill';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';
// @ts-ignore
import api from '@actual-app/api';
import AdmZip from 'adm-zip';

import { parseMathInput } from '../shared/features/SafeMath/index.js';
import { featureRouters } from './src/features/index';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.ACTUAL_DATA_DIR || path.join(process.cwd(), '.actual-data');

let isSyncing = false;
let syncError: string | null = null;
let lastSyncTime: Date | null = null;
let dbPathCache: string | null = null;

// Resolve SQLite Database Path recursively
function getDbPath(): string {
  if (dbPathCache && fs.existsSync(dbPathCache)) {
    return dbPathCache;
  }

  // Find db.sqlite in DATA_DIR
  const findDbFile = (dir: string): string | null => {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const found = findDbFile(fullPath);
        if (found) return found;
      } else if (file === 'db.sqlite') {
        return fullPath;
      }
    }
    return null;
  };

  if (!fs.existsSync(DATA_DIR)) {
    throw new Error(`Data directory ${DATA_DIR} does not exist. Please run sync first.`);
  }

  const foundPath = findDbFile(DATA_DIR);
  if (!foundPath) {
    throw new Error('Local Actual database (db.sqlite) not found in data directory.');
  }

  dbPathCache = foundPath;
  return foundPath;
}

// Run a read-only query against local SQLite DB
export function queryLocalDb<T = any>(query: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    try {
      const dbFile = getDbPath();
      const db = new sqlite3.Database(dbFile, sqlite3.OPEN_READONLY, (err) => {
        if (err) return reject(err);
      });

      db.all(query, params, (err, rows) => {
        db.close();
        if (err) return reject(err);
        resolve(rows as T[]);
      });
    } catch (e) {
      reject(e);
    }
  });
}

// Actual Sync logic
async function doSync() {
  if (isSyncing) return;
  isSyncing = true;
  syncError = null;

  const serverUrl = process.env.ACTUAL_SERVER_URL;
  const password = process.env.ACTUAL_PASSWORD;
  const syncId = process.env.ACTUAL_SYNC_ID;
  const encryptionPassword = process.env.ACTUAL_ENCRYPTION_PASSWORD;

  if (!serverUrl || !password || !syncId) {
    syncError = "Missing ACTUAL_SERVER_URL, ACTUAL_PASSWORD, or ACTUAL_SYNC_ID env variables";
    console.error(syncError);
    isSyncing = false;
    return;
  }

  try {
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
    
    lastSyncTime = new Date();
    dbPathCache = null; // Invalidate cache in case path changed
    console.log("Sync completed successfully!");
  } catch (err: any) {
    syncError = err.message || String(err);
    console.error("Sync failed:", syncError);
    try {
      await api.shutdown();
    } catch (e) {}
  } finally {
    isSyncing = false;
  }
}

// Start periodic sync (every 15 minutes)
function startPeriodicSync() {
  doSync();
  setInterval(doSync, 15 * 60 * 1000);
}

// Rotate backups: keep only the 10 most recent files
function rotateBackups(backupDir: string) {
  try {
    const files = fs.readdirSync(backupDir);
    const zipFiles = files
      .filter(file => file.endsWith('.zip'))
      .map(file => ({
        name: file,
        path: path.join(backupDir, file),
        mtime: fs.statSync(path.join(backupDir, file)).mtime.getTime()
      }));
      
    zipFiles.sort((a, b) => b.mtime - a.mtime);
    
    if (zipFiles.length > 10) {
      const filesToDelete = zipFiles.slice(10);
      for (const file of filesToDelete) {
        fs.unlinkSync(file.path);
        console.log(`[Backup] Deleted old backup file: ${file.name}`);
      }
    }
  } catch (error) {
    console.error('[Backup] Rotation error:', error);
  }
}

// Perform budget backup
export async function runBackup(): Promise<string> {
  const dbPath = getDbPath();
  const budgetDir = path.dirname(dbPath);
  const backupDir = path.join(DATA_DIR, 'budget-backup');
  
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  const now = new Date();
  const DD = String(now.getDate()).padStart(2, '0');
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const YYYY = now.getFullYear();
  const HH = String(now.getHours()).padStart(2, '0');
  const Min = String(now.getMinutes()).padStart(2, '0');
  const SS = String(now.getSeconds()).padStart(2, '0');
  
  const filename = `${DD}${MM}${YYYY}${HH}${Min}${SS}.zip`;
  const zipPath = path.join(backupDir, filename);
  
  console.log(`[Backup] Starting backup to ${zipPath}...`);
  
  const zip = new AdmZip();
  
  const dbFile = path.join(budgetDir, 'db.sqlite');
  if (fs.existsSync(dbFile)) {
    zip.addLocalFile(dbFile);
  } else {
    throw new Error(`db.sqlite not found at ${dbFile}`);
  }
  
  const metaFile = path.join(budgetDir, 'metadata.json');
  if (fs.existsSync(metaFile)) {
    zip.addLocalFile(metaFile);
  }
  
  zip.writeZip(zipPath);
  console.log(`[Backup] Backup written successfully: ${filename}`);
  
  rotateBackups(backupDir);
  return filename;
}

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
    isSyncing,
    syncError,
    lastSyncTime: lastSyncTime ? lastSyncTime.toISOString() : null,
  });
});

app.post('/api/sync', async (req, res) => {
  if (isSyncing) {
    return res.status(409).json({ error: "Sync is already in progress" });
  }
  await doSync();
  if (syncError) {
    res.status(500).json({ error: syncError });
  } else {
    res.json({ success: true, lastSyncTime });
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

app.post('/api/backup', async (req, res) => {
  try {
    const filename = await runBackup();
    res.json({ success: true, filename });
  } catch (err: any) {
    console.error("Manual backup failed:", err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get('/api/backups', (req, res) => {
  try {
    const backupDir = path.join(DATA_DIR, 'budget-backup');
    if (!fs.existsSync(backupDir)) {
      return res.json({ backups: [] });
    }
    const files = fs.readdirSync(backupDir);
    const backups = files
      .filter(file => file.endsWith('.zip'))
      .map(file => {
        const filePath = path.join(backupDir, file);
        const stat = fs.statSync(filePath);
        return {
          filename: file,
          size: stat.size,
          createdAt: stat.mtime.toISOString()
        };
      });
    backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ backups });
  } catch (err: any) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get('/api/backups/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const safeFilename = path.basename(filename);
  const backupDir = path.join(DATA_DIR, 'budget-backup');
  const filePath = path.join(backupDir, safeFilename);

  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: 'Backup file not found' });
  }
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
