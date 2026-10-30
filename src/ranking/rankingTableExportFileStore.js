/**
 * Short-lived Table View Excel files for download-by-URL.
 * Files live under os.tmpdir() and expire after TTL.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const TTL_MS = 15 * 60 * 1000;
const DIR = path.join(os.tmpdir(), 'uphealth-table-exports');
/** @type {Map<string, { filePath: string, filename: string, expiresAt: number, userId: string|null }>} */
const jobs = new Map();

function ensureDir() {
  if (!fs.existsSync(DIR)) {
    fs.mkdirSync(DIR, { recursive: true });
  }
}

function purgeExpired() {
  const now = Date.now();
  for (const [id, meta] of jobs.entries()) {
    if (meta.expiresAt <= now) {
      try {
        if (fs.existsSync(meta.filePath)) fs.unlinkSync(meta.filePath);
      } catch {
        /* ignore */
      }
      jobs.delete(id);
    }
  }
}

/**
 * @param {{ buffer: Buffer, filename: string, userId?: string|null }} opts
 * @returns {{ jobId: string, filename: string, expiresAt: number, expiresInSec: number }}
 */
function storeExportFile({ buffer, filename, userId = null }) {
  ensureDir();
  purgeExpired();

  const jobId = crypto.randomBytes(16).toString('hex');
  const safeName = String(filename || 'export.xlsx').replace(/[^\w.\-]+/g, '_');
  const filePath = path.join(DIR, `${jobId}.xlsx`);
  fs.writeFileSync(filePath, buffer);

  const expiresAt = Date.now() + TTL_MS;
  jobs.set(jobId, {
    filePath,
    filename: safeName.endsWith('.xlsx') ? safeName : `${safeName}.xlsx`,
    expiresAt,
    userId: userId != null ? String(userId) : null,
  });

  return {
    jobId,
    filename: jobs.get(jobId).filename,
    expiresAt,
    expiresInSec: Math.floor(TTL_MS / 1000),
  };
}

/**
 * @param {string} jobId
 * @param {{ userId?: string|null }} [opts]
 */
function takeExportFile(jobId, { userId = null } = {}) {
  purgeExpired();
  const meta = jobs.get(String(jobId || ''));
  if (!meta) return null;
  if (meta.expiresAt <= Date.now()) {
    jobs.delete(jobId);
    return null;
  }
  if (meta.userId && userId != null && String(meta.userId) !== String(userId)) {
    const err = new Error('Not allowed to download this export');
    err.status = 403;
    throw err;
  }
  if (!fs.existsSync(meta.filePath)) {
    jobs.delete(jobId);
    return null;
  }
  return meta;
}

/** Optional: delete after successful download. */
function removeExportFile(jobId) {
  const meta = jobs.get(String(jobId || ''));
  if (!meta) return;
  try {
    if (fs.existsSync(meta.filePath)) fs.unlinkSync(meta.filePath);
  } catch {
    /* ignore */
  }
  jobs.delete(String(jobId));
}

module.exports = {
  storeExportFile,
  takeExportFile,
  removeExportFile,
  TTL_MS,
};
