import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sqlite3 from 'sqlite3';
import type { IDbClient } from '../../backend/src/infrastructure/db/IDbClient';
import { MonthlySpendingService } from '../../backend/src/features/MonthlySpending/service';

class InMemoryDbClient implements IDbClient {
  private db: sqlite3.Database;

  constructor() {
    this.db = new sqlite3.Database(':memory:');
  }

  public query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows as T[]);
      });
    });
  }

  public run(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public close() {
    this.db.close();
  }
}

describe('Database Integration Tests', () => {
  let dbClient: InMemoryDbClient;

  beforeAll(async () => {
    dbClient = new InMemoryDbClient();
    
    // Create necessary schema for v_transactions, accounts, payees, categories
    await dbClient.run(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        name TEXT,
        offbudget INTEGER,
        closed INTEGER,
        tombstone INTEGER
      )
    `);

    await dbClient.run(`
      CREATE TABLE payees (
        id TEXT PRIMARY KEY,
        name TEXT,
        transfer_acct TEXT,
        tombstone INTEGER
      )
    `);

    await dbClient.run(`
      CREATE TABLE categories (
        id TEXT PRIMARY KEY,
        name TEXT,
        is_income INTEGER,
        tombstone INTEGER
      )
    `);

    await dbClient.run(`
      CREATE TABLE v_transactions (
        id TEXT PRIMARY KEY,
        date TEXT,
        amount INTEGER,
        account TEXT,
        payee TEXT,
        category TEXT,
        is_parent INTEGER,
        tombstone INTEGER
      )
    `);

    // Insert dummy data
    await dbClient.run(`INSERT INTO accounts (id, name, offbudget, closed, tombstone) VALUES ('acc1', 'Checking', 0, 0, 0)`);
    await dbClient.run(`INSERT INTO categories (id, name, is_income, tombstone) VALUES ('cat1', 'Salary', 1, 0)`);
    await dbClient.run(`INSERT INTO categories (id, name, is_income, tombstone) VALUES ('cat2', 'Groceries', 0, 0)`);
    
    await dbClient.run(`
      INSERT INTO v_transactions (id, date, amount, account, payee, category, is_parent, tombstone) 
      VALUES ('tx1', '20240615', 100000, 'acc1', null, 'cat1', 0, 0)
    `); // $1000 income
    await dbClient.run(`
      INSERT INTO v_transactions (id, date, amount, account, payee, category, is_parent, tombstone) 
      VALUES ('tx2', '20240616', -5000, 'acc1', null, 'cat2', 0, 0)
    `); // $50 expense
  });

  afterAll(() => {
    dbClient.close();
  });

  it('MonthlySpendingService should correctly query and calculate totals from real SQLite memory db', async () => {
    const service = new MonthlySpendingService(dbClient);
    
    const result = await service.getMonthlySpending('2024-06');
    
    // Should correctly join tables and aggregate $1000 income and $50 expense
    expect(result.totalIncome).toBe(1000);
    expect(result.totalSpent).toBe(50);
    expect(result.netIncome).toBe(950);
    
    expect(result.income).toHaveLength(1);
    expect(result.income[0].Category_Name).toBe('Salary');
    expect(result.income[0].amount).toBe(1000);
    
    expect(result.expenses).toHaveLength(1);
    expect(result.expenses[0].Category_Name).toBe('Groceries');
    expect(result.expenses[0].amount).toBe(50);
  });
});
