import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';

const DATA_DIR = process.env.ACTUAL_DATA_DIR || path.join(process.cwd(), '.actual-data');

let dbPathCache: string | null = null;
let _db: sqlite3.Database | null = null;

// Resolve SQLite Database Path optimally
export function getDbPath(): string {
  if (dbPathCache && fs.existsSync(dbPathCache)) {
    return dbPathCache;
  }

  const t0 = performance.now();

  if (!fs.existsSync(DATA_DIR)) {
    throw new Error(`Data directory ${DATA_DIR} does not exist. Please run sync first.`);
  }

  const syncId = process.env.ACTUAL_SYNC_ID;
  let foundPath: string | null = null;

  // Actual Budget data structure: db.sqlite is either at DATA_DIR/db.sqlite (legacy)
  // or in DATA_DIR/<budget-id>/db.sqlite.
  // We perform a shallow scan and match against metadata.json's groupId to guarantee correctness
  // without recursively scanning huge backup directories.
  
  if (fs.existsSync(path.join(DATA_DIR, 'db.sqlite'))) {
    foundPath = path.join(DATA_DIR, 'db.sqlite');
  }

  if (!foundPath) {
    const files = fs.readdirSync(DATA_DIR);
    for (const file of files) {
      if (file === 'budget-backup') continue;
      
      const fullDir = path.join(DATA_DIR, file);
      if (fs.statSync(fullDir).isDirectory()) {
        const potentialDb = path.join(fullDir, 'db.sqlite');
        const metadataPath = path.join(fullDir, 'metadata.json');
        
        if (fs.existsSync(potentialDb)) {
          if (syncId && fs.existsSync(metadataPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
              if (meta.groupId === syncId) {
                foundPath = potentialDb;
                break;
              }
            } catch (e) {
              // Ignore invalid metadata
            }
          } else {
            // Fallback if no syncId or metadata
            foundPath = potentialDb;
            break;
          }
        }
      }
    }
  }

  const t1 = performance.now();
  console.log(`[getDbPath] Resolved DB path in ${(t1 - t0).toFixed(2)}ms`);

  if (!foundPath) {
    throw new Error('Local Actual database (db.sqlite) not found in data directory.');
  }

  dbPathCache = foundPath;
  return foundPath;
}

export function getDb(): sqlite3.Database {
  if (!_db) {
    _db = new sqlite3.Database(getDbPath(), sqlite3.OPEN_READONLY);
  }
  return _db;
}

export function resetDbConnection() {
  if (_db) {
    _db.close();
    _db = null;
  }
  dbPathCache = null;
}

import type { IDbClient, SqlParam } from '../infrastructure/db/IDbClient.js';

export class LocalDbClient implements IDbClient {
  public query<T = any>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      try {
        const db = getDb();
        db.all(sql, params, (err, rows) => {
          if (err) return reject(err);
          resolve(rows as T[]);
        });
      } catch (e) {
        reject(e);
      }
    });
  }
}

export const defaultDbClient = new LocalDbClient();

// Run a read-only query against local SQLite DB (Legacy wrapper)
export function queryLocalDb<T = any>(query: string, params: SqlParam[] = []): Promise<T[]> {
  return defaultDbClient.query(query, params);
}
