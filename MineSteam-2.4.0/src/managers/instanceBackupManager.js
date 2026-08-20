const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');
const { app, shell } = require('electron');
const { assertInstancePath, assertReadableFile, resolveInside } = require('../core/security');

const BACKUPS_ROOT = path.join(app.getPath('userData'), 'backups', 'instances');
const SAFE_EXCLUDED = new Set(['backups', '.minesteam-backups']);

function safeName(value) {
  return String(value || 'instancia').trim().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').slice(0, 80) || 'instancia';
}

function collectFiles(root, current = root, out = []) {
  if (!fs.existsSync(current)) return out;
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    const rel = path.relative(root, full).replace(/\\/g, '/');
    const first = rel.split('/')[0];
    if (SAFE_EXCLUDED.has(first)) continue;
    if (entry.isDirectory()) collectFiles(root, full, out);
    else if (entry.isFile()) out.push({ full, rel });
  }
  return out;
}

async function createInstanceBackup(instancePath, reason = 'manual') {
  const safeInstance = assertInstancePath(instancePath);
  await fs.ensureDir(BACKUPS_ROOT);
  const name = safeName(path.basename(safeInstance));
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${name}-${stamp}.msteam-backup.zip`;
  const destination = resolveInside(BACKUPS_ROOT, path.join(BACKUPS_ROOT, fileName));
  const zip = new AdmZip();
  const files = collectFiles(safeInstance);
  for (const item of files) zip.addLocalFile(item.full, path.dirname(item.rel) === '.' ? '' : path.dirname(item.rel), path.basename(item.rel));
  zip.addFile('backup.json', Buffer.from(JSON.stringify({
    format: 1,
    type: 'minesteam-instance-backup',
    reason,
    instanceName: name,
    createdAt: new Date().toISOString(),
    fileCount: files.length
  }, null, 2)));
  zip.writeZip(destination);
  return { success: true, path: destination, name: fileName, fileCount: files.length, reason };
}

async function listInstanceBackups(instancePath) {
  const safeInstance = assertInstancePath(instancePath);
  const prefix = `${safeName(path.basename(safeInstance))}-`;
  await fs.ensureDir(BACKUPS_ROOT);
  const result = [];
  for (const name of fs.readdirSync(BACKUPS_ROOT)) {
    if (!name.startsWith(prefix) || !name.endsWith('.msteam-backup.zip')) continue;
    const full = resolveInside(BACKUPS_ROOT, path.join(BACKUPS_ROOT, name));
    const stat = await fs.stat(full);
    result.push({ name, path: full, size: stat.size, modifiedAt: stat.mtime.toISOString() });
  }
  return result.sort((a,b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
}

async function restoreInstanceBackup(instancePath, backupFile) {
  const safeInstance = assertInstancePath(instancePath);
  const safeBackup = assertReadableFile(backupFile, ['.zip']);
  const backupRoot = path.resolve(BACKUPS_ROOT);
  if (path.resolve(safeBackup) !== backupRoot && !path.resolve(safeBackup).startsWith(backupRoot + path.sep)) {
    throw new Error('La copia de seguridad no pertenece a MineSteam');
  }
  const zip = new AdmZip(safeBackup);
  const entries = zip.getEntries().filter(e => !e.isDirectory && e.entryName && e.entryName !== 'backup.json');
  if (!entries.length) throw new Error('La copia de seguridad está vacía');
  for (const e of entries) {
    const normalized = e.entryName.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.includes('../') || /^[A-Za-z]:\//.test(normalized)) throw new Error('La copia contiene una ruta insegura');
  }
  const staging = `${safeInstance}.restore-${Date.now()}`;
  await fs.ensureDir(staging);
  try {
    zip.extractAllTo(staging, true);
    const meta = path.join(staging, 'version.json');
    if (!fs.existsSync(meta)) throw new Error('La copia no contiene version.json');
    const old = `${safeInstance}.old-${Date.now()}`;
    await fs.move(safeInstance, old);
    try {
      await fs.move(staging, safeInstance);
      await fs.remove(old);
    } catch (error) {
      await fs.remove(safeInstance).catch(()=>{});
      await fs.move(old, safeInstance).catch(()=>{});
      throw error;
    }
  } finally {
    await fs.remove(staging).catch(()=>{});
  }
  return { success: true, restoredFrom: safeBackup, instancePath: safeInstance };
}

function getLogsDirectory(instancePath) {
  const safe = assertInstancePath(instancePath);
  return path.join(safe, '.minecraft', 'logs');
}

async function listLogs(instancePath) {
  const dir = getLogsDirectory(instancePath);
  await fs.ensureDir(dir);
  const result = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = await fs.stat(full);
    if (!stat.isFile()) continue;
    result.push({ name, path: full, size: stat.size, modifiedAt: stat.mtime.toISOString() });
  }
  const runtime = path.join(assertInstancePath(instancePath), 'minecraft-runtime.log');
  if (fs.existsSync(runtime)) {
    const stat = await fs.stat(runtime);
    result.unshift({ name: 'minecraft-runtime.log', path: runtime, size: stat.size, modifiedAt: stat.mtime.toISOString(), runtime: true });
  }
  return result.sort((a,b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
}

async function readLog(instancePath, fileName) {
  const safe = assertInstancePath(instancePath);
  const runtime = fileName === 'minecraft-runtime.log';
  const base = runtime ? safe : getLogsDirectory(safe);
  const name = String(fileName || '').trim();
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new Error('Nombre de log inválido');
  const full = resolveInside(base, path.join(base, name));
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error('El log no existe');
  const text = await fs.readFile(full, 'utf8');
  return { success: true, name, path: full, content: text.slice(-500000) };
}

async function openLogsFolder(instancePath) {
  const dir = getLogsDirectory(instancePath);
  await fs.ensureDir(dir);
  const error = await shell.openPath(dir);
  if (error) throw new Error(error);
  return { success: true, path: dir };
}

module.exports = {
  BACKUPS_ROOT,
  createInstanceBackup,
  listInstanceBackups,
  restoreInstanceBackup,
  listLogs,
  readLog,
  openLogsFolder
};
