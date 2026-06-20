import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';

const DATA_DIR = process.env.ACTUAL_DATA_DIR || path.join(process.cwd(), '.actual-data');

let dbPathCache: string | null = null;
let _db: sqlite3.Database | null = null;

// Resolve SQLite Database Path recursively
export function getDbPath(): string {
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

// Run a read-only query against local SQLite DB
export function queryLocalDb<T = any>(query: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    try {
      const db = getDb();
      db.all(query, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows as T[]);
      });
    } catch (e) {
      reject(e);
    }
  });
}
