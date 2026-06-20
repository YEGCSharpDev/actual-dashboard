import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { runBackup } from './service.js';

const DATA_DIR = process.env.ACTUAL_DATA_DIR || path.join(process.cwd(), '.actual-data');
const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const filename = await runBackup();
    res.json({ success: true, filename });
  } catch (err: any) {
    console.error("Manual backup failed:", err);
    // Let global error handler catch it
    next(err);
  }
});

router.get('/', (req, res, next) => {
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
    next(err);
  }
});

router.get('/download/:filename', (req, res, next) => {
  try {
    const filename = req.params.filename;
    const safeFilename = path.basename(filename);
    const backupDir = path.join(DATA_DIR, 'budget-backup');
    const filePath = path.join(backupDir, safeFilename);

    if (fs.existsSync(filePath)) {
      res.download(filePath);
    } else {
      res.status(404).json({ error: 'Backup file not found' });
    }
  } catch (err: any) {
    next(err);
  }
});

export const backupRouter = router;
