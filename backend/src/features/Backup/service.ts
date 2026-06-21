import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { getDbPath } from '../../db/client.js';

const DATA_DIR = process.env.ACTUAL_DATA_DIR || path.join(process.cwd(), '.actual-data');

// Rotate backups: keep only the 10 most recent files
export function rotateBackups(backupDir: string) {
  try {
    if (!fs.existsSync(backupDir)) return;
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
  const YYYY = now.getFullYear();
  const MM = String(now.getMonth() + 1).padStart(2, '0');
  const DD = String(now.getDate()).padStart(2, '0');
  const HH = String(now.getHours()).padStart(2, '0');
  const Min = String(now.getMinutes()).padStart(2, '0');
  const SS = String(now.getSeconds()).padStart(2, '0');
  
  const suffix = Math.random().toString(36).substring(2, 6);
  const filename = `${YYYY}${MM}${DD}_${HH}${Min}${SS}_${suffix}.zip`;
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
