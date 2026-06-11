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
function queryLocalDb<T = any>(query: string, params: any[] = []): Promise<T[]> {
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
export function parseMathInput(exprStr: string): number {
  if (!exprStr || !exprStr.trim()) return 0;
  
  const clean = exprStr.replace(/\s+/g, '');
  if (!/^[0-9+\-*/().]+$/.test(clean)) {
    return 0;
  }

  try {
    const result = evaluateSimpleExpression(clean);
    return isNaN(result) ? 0 : result;
  } catch (e) {
    return 0;
  }
}

function evaluateSimpleExpression(expr: string): number {
  const tokens: string[] = [];
  let numAccum = '';
  
  for (let i = 0; i < expr.length; i++) {
    const char = expr[i];
    if (/[0-9.]/.test(char)) {
      numAccum += char;
    } else {
      if (numAccum) {
        tokens.push(numAccum);
        numAccum = '';
      }
      tokens.push(char);
    }
  }
  if (numAccum) {
    tokens.push(numAccum);
  }

  const parseNoParens = (toks: string[]): number => {
    const intermediate: (number | string)[] = [];
    let i = 0;
    while (i < toks.length) {
      const tok = toks[i];
      if (tok === '*' || tok === '/') {
        const left = Number(intermediate.pop());
        const right = Number(toks[i + 1]);
        if (tok === '*') {
          intermediate.push(left * right);
        } else {
          intermediate.push(left / right);
        }
        i += 2;
      } else {
        intermediate.push(isNaN(Number(tok)) ? tok : Number(tok));
        i++;
      }
    }

    if (intermediate.length === 0) return 0;
    let res = Number(intermediate[0]);
    let j = 1;
    while (j < intermediate.length) {
      const op = intermediate[j];
      const val = Number(intermediate[j + 1]);
      if (op === '+') {
        res += val;
      } else if (op === '-') {
        res -= val;
      }
      j += 2;
    }
    return res;
  };

  let hasParens = tokens.includes('(');
  let limit = 100;
  while (hasParens && limit > 0) {
    limit--;
    let openIdx = -1;
    let closeIdx = -1;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === '(') {
        openIdx = i;
      } else if (tokens[i] === ')') {
        closeIdx = i;
        break;
      }
    }
    if (openIdx !== -1 && closeIdx !== -1) {
      const subExpression = tokens.slice(openIdx + 1, closeIdx);
      const val = parseNoParens(subExpression);
      tokens.splice(openIdx, closeIdx - openIdx + 1, val.toString());
    } else {
      break;
    }
    hasParens = tokens.includes('(');
  }

  return parseNoParens(tokens);
}

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

// Primary Endpoint to fetch dashboard data
app.get('/api/data', async (req, res) => {
  const selectedMonth = req.query.month as string; // YYYY-MM
  if (!selectedMonth || !/^\d{4}-\d{2}$/.test(selectedMonth)) {
    return res.status(400).json({ error: "Query parameter 'month' in YYYY-MM format is required" });
  }

  try {
    const currentYear = new Date().getFullYear();
    const queryMonthSql = selectedMonth.replace('-', '');

    // 1. Fetch Accounts
    const accounts = await queryLocalDb(`
      SELECT id, name, offbudget, closed, tombstone
      FROM accounts
      WHERE tombstone = 0
    `);

    // Get account balances (enrich on-budget and active accounts)
    // We can query this from the db.sqlite using the current balance stored in accounts
    // Actual's account table has a balance column in cents.
    // Wait, let's verify if there is a 'balance' column in the accounts table.
    // Yes! The accounts table in Actual has a 'balance' or we can query it.
    // Let's do a quick query to verify. Wait, we can also query the sum of transactions for that account.
    // But accounts table usually has a balance column, let's select accounts with balance.
    const rawAccounts = await queryLocalDb(`
      SELECT 
        a.id, 
        a.name, 
        a.offbudget, 
        a.closed, 
        COALESCE(SUM(t.amount), 0) as balance_current
      FROM accounts a
      LEFT JOIN v_transactions t ON a.id = t.account AND t.tombstone = 0 AND t.is_parent = 0
      WHERE a.tombstone = 0 AND a.closed = 0
      GROUP BY a.id, a.name, a.offbudget, a.closed
    `);

    const enrichedAccounts = rawAccounts.map(acc => ({
      id: acc.id,
      name: acc.name,
      offbudget: Boolean(acc.offbudget),
      closed: Boolean(acc.closed),
      balance_current: acc.balance_current !== undefined ? acc.balance_current : null
    }));

    // 2. Fetch Transactions (Since Jan 1 of current year)
    const transactions = await queryLocalDb(`
      SELECT 
        t.id, 
        t.date, 
        t.amount, 
        t.account, 
        a.name as account_name,
        a.offbudget as account_offbudget,
        p.name as payee_name, 
        c.id as category_id, 
        c.name as category_name, 
        c.is_income as category_is_income,
        cg.name as group_name
      FROM v_transactions t
      LEFT JOIN accounts a ON t.account = a.id
      LEFT JOIN payees p ON t.payee = p.id
      LEFT JOIN categories c ON t.category = c.id
      LEFT JOIN category_groups cg ON c.cat_group = cg.id
      WHERE t.tombstone = 0 
        AND t.is_parent = 0
        AND t.date >= ?
    `, [`${currentYear}0101`]);

    const CENTS_DIVISOR = -100.0;
    const formatDate = (rawDate: any): string => {
      if (!rawDate) return '';
      const str = String(rawDate);
      if (str.length === 8) {
        return `${str.substring(0, 4)}-${str.substring(4, 6)}-${str.substring(6, 8)}`;
      }
      return str;
    };

    const normalizedTransactions = transactions.map(t => ({
      id: t.id,
      date: formatDate(t.date),
      amount: t.amount / CENTS_DIVISOR, // Outflow positive, Inflow negative
      amount_dollars: t.amount / 100.0, // Inflow positive, Outflow negative
      account: t.account,
      account_name: t.account_name || 'Unknown',
      account_offbudget: Boolean(t.account_offbudget),
      Payee_Name: t.payee_name || 'Unknown',
      category: t.category_id,
      Category_Name: t.category_name || 'Uncategorized',
      is_income: Boolean(t.category_is_income),
      Group_Name: t.group_name || 'Other'
    }));

    // 3. Fetch Budgets for selected month (budgeted amounts in cents, so we divide by 100)
    const budgetsRaw = await queryLocalDb(`
      SELECT c.name, COALESCE(zb.amount, 0) / 100.0 as budgeted
      FROM zero_budgets zb
      INNER JOIN categories c ON c.id = zb.category
      WHERE zb.month = ?
    `, [queryMonthSql]);

    const budgets: Record<string, number> = {};
    budgetsRaw.forEach(b => {
      budgets[b.name] = b.budgeted;
    });

    // 4. Fetch Underfunded amounts (for selected month and next 2 months)
    const targetMonths: string[] = [];
    const dateObj = new Date(selectedMonth + '-02'); // middle of month to avoid timezone shifts
    for (let i = 0; i < 3; i++) {
      const m = new Date(dateObj.getFullYear(), dateObj.getMonth() + i, 1);
      const yearStr = m.getFullYear();
      const monthStr = String(m.getMonth() + 1).padStart(2, '0');
      targetMonths.push(`${yearStr}${monthStr}`);
    }

    const underbudget: Record<string, number> = {};
    for (const mStr of targetMonths) {
      const rows = await queryLocalDb(`
        SELECT COALESCE(SUM(zero_budgets.goal - zero_budgets.amount), 0) / 100.0 as underfunded
        FROM zero_budgets
        INNER JOIN categories ON categories.id = zero_budgets.category
        WHERE month = ?
          AND amount < goal;
      `, [mStr]);
      underbudget[mStr] = rows[0]?.underfunded || 0;
    }

    // 5. Build parsed environment configs to send to frontend
    // Categories config
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

    const cleanEnvString = (val: string | undefined, defaultVal: string = ''): string => {
      if (!val) return defaultVal;
      return val.trim().replace(/^['"]|['"]$/g, '');
    };

    const tfsaTracking = parseJsonEnvArray(process.env.ACTUAL_TFSA_TRACKING);
    const budgetTracking = parseJsonEnvArray(process.env.ACTUAL_BUDGET_TRACKING);

    // Investments configurations
    const respConfig = {
      identifier: cleanEnvString(process.env.ACTUAL_RESP_IDENTIFIER, 'RESP'),
      horizon_years: Number(process.env.ACTUAL_RESP_HORIZON_YEARS || 10),
      default_return_pct: Number(process.env.ACTUAL_RESP_DEFAULT_RETURN_PCT || 4.0),
      monthly_contribution: Number(process.env.ACTUAL_RESP_MONTHLY_CONTRIBUTION || 0.0),
    };

    const rrspConfig = {
      identifier: cleanEnvString(process.env.ACTUAL_RRSP_IDENTIFIER, 'RRSP'),
      horizon_years: Number(process.env.ACTUAL_RRSP_HORIZON_YEARS || 30),
      default_return_pct: Number(process.env.ACTUAL_RRSP_DEFAULT_RETURN_PCT || 8.0),
      annual_contribution: Number(process.env.ACTUAL_RRSP_ANNUAL_CONTRIBUTION || 0.0),
    };

    const tfsaConfig = {
      horizon_years: Number(process.env.ACTUAL_TFSA_HORIZON_YEARS || 30),
      ytd_limit: Number(process.env.ACTUAL_TFSA_YTD_LIMIT || 7000.0),
      total_room: Number(process.env.ACTUAL_TFSA_TOTAL_ROOM || process.env.ACTUAL_TFSA_ANNUAL_ROOM || 7000.0),
      base: {
        identifier: cleanEnvString(process.env.ACTUAL_TFSA_BASE_IDENTIFIER, ''),
        default_return_pct: Number(process.env.ACTUAL_TFSA_BASE_DEFAULT_RETURN_PCT || 4.0),
        monthly_contribution: Number(process.env.ACTUAL_TFSA_BASE_MONTHLY_CONTRIBUTION || 0.0),
      },
      catchup: {
        identifier: cleanEnvString(process.env.ACTUAL_TFSA_CATCHUP_IDENTIFIER, ''),
        default_return_pct: Number(process.env.ACTUAL_TFSA_CATCHUP_DEFAULT_RETURN_PCT || 8.0),
        catchup_year_contribution: Number(process.env.ACTUAL_TFSA_CATCHUP_YEAR_CONTRIBUTION || 0.0),
      }
    };

    const hasRESP = !!(
      process.env.ACTUAL_RESP_IDENTIFIER ||
      process.env.ACTUAL_RESP_HORIZON_YEARS ||
      process.env.ACTUAL_RESP_DEFAULT_RETURN_PCT ||
      process.env.ACTUAL_RESP_MONTHLY_CONTRIBUTION
    );

    const hasRRSP = !!(
      process.env.ACTUAL_RRSP_IDENTIFIER ||
      process.env.ACTUAL_RRSP_HORIZON_YEARS ||
      process.env.ACTUAL_RRSP_DEFAULT_RETURN_PCT ||
      process.env.ACTUAL_RRSP_ANNUAL_CONTRIBUTION
    );

    const hasTFSA = !!(
      process.env.ACTUAL_TFSA_TRACKING ||
      process.env.ACTUAL_TFSA_HORIZON_YEARS ||
      process.env.ACTUAL_TFSA_YTD_LIMIT ||
      process.env.ACTUAL_TFSA_TOTAL_ROOM ||
      process.env.ACTUAL_TFSA_ANNUAL_ROOM ||
      process.env.ACTUAL_TFSA_BASE_IDENTIFIER ||
      process.env.ACTUAL_TFSA_BASE_DEFAULT_RETURN_PCT ||
      process.env.ACTUAL_TFSA_BASE_MONTHLY_CONTRIBUTION ||
      process.env.ACTUAL_TFSA_CATCHUP_IDENTIFIER ||
      process.env.ACTUAL_TFSA_CATCHUP_DEFAULT_RETURN_PCT ||
      process.env.ACTUAL_TFSA_CATCHUP_YEAR_CONTRIBUTION
    );

    const hasInvestments = hasRESP || hasRRSP || hasTFSA;

    res.json({
      accounts: enrichedAccounts,
      transactions: normalizedTransactions,
      budgets,
      underbudget,
      config: {
        categories: { tfsa_tracking: tfsaTracking, budget_tracking: budgetTracking },
        resp: respConfig,
        rrsp: rrspConfig,
        tfsa: tfsaConfig,
        hasInvestments,
        hasRESP,
        hasRRSP,
        hasTFSA,
      },
      error: null
    });

  } catch (err: any) {
    console.error("Failed to load dashboard data:", err);
    res.status(500).json({ error: err.message || String(err) });
  }
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
