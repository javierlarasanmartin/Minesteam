const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');
const { app } = require('electron');
const { assertInstancePath, assertReadableFile, resolveInside } = require('../core/security');

const EXPORTS_DIR = path.join(app.getPath('userData'), 'exports');

function safeName(name) {
  const value = String(name || '').trim().replace(/[\\/:*?"<>|]+/g, '_');
  return value || 'instancia';
}

function instanceMinecraftDir(instancePath) {
  return resolveInside(assertInstancePath(instancePath), path.join(assertInstancePath(instancePath), '.minecraft'));
}

function getSaveDir(instancePath, worldName) {
  const root = resolveInside(instanceMinecraftDir(instancePath), path.join(instanceMinecraftDir(instancePath), 'saves'));
  const name = String(worldName || '').trim();
  if (!name || /[\\/]/.test(name) || name === '.' || name === '..') throw new Error('Mundo inválido');
  return resolveInside(root, path.join(root, name));
}

async function listWorldBackups(instancePath) {
  const safeInstance = assertInstancePath(instancePath);
  const backupDir = resolveInside(safeInstance, path.join(safeInstance, 'backups', 'worlds'));
  await fs.ensureDir(backupDir);
  const names = await fs.readdir(backupDir);
  const result = [];
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.zip')) continue;
    const full = resolveInside(backupDir, path.join(backupDir, name));
    const stat = await fs.stat(full);
    result.push({ name, path: full, size: stat.size, modifiedAt: stat.mtime.toISOString() });
  }
  return result.sort((a,b)=>new Date(b.modifiedAt)-new Date(a.modifiedAt));
}

async function backupWorld(instancePath, worldName) {
  const safeInstance = assertInstancePath(instancePath);
  const worldDir = getSaveDir(safeInstance, worldName);
  if (!(await fs.pathExists(worldDir))) throw new Error('El mundo no existe');
  const levelDat = path.join(worldDir, 'level.dat');
  if (!(await fs.pathExists(levelDat))) throw new Error('La carpeta seleccionada no parece ser un mundo válido (falta level.dat)');

  const backupDir = resolveInside(safeInstance, path.join(safeInstance, 'backups', 'worlds'));
  await fs.ensureDir(backupDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${safeName(worldName)}-${stamp}.zip`;
  const destination = resolveInside(backupDir, path.join(backupDir, fileName));

  const zip = new AdmZip();
  zip.addLocalFolder(worldDir, safeName(worldName));
  zip.writeZip(destination);
  return { success: true, name: fileName, path: destination };
}

async function restoreWorldBackup(instancePath, backupFile) {
  const safeInstance = assertInstancePath(instancePath);
  const safeBackup = assertReadableFile(backupFile, ['.zip']);
  const backupDir = resolveInside(safeInstance, path.join(safeInstance, 'backups', 'worlds'));
  if (!resolveInside(backupDir, safeBackup).startsWith(backupDir + path.sep)) throw new Error('La copia de seguridad no pertenece a la instancia');

  const zip = new AdmZip(safeBackup);
  const entries = zip.getEntries().filter(e => !e.isDirectory && e.entryName);
  if (!entries.length) throw new Error('La copia de seguridad está vacía');
  const top = entries[0].entryName.split('/')[0];
  const worldName = safeName(top);
  const saveRoot = resolveInside(instanceMinecraftDir(safeInstance), path.join(instanceMinecraftDir(safeInstance), 'saves'));
  await fs.ensureDir(saveRoot);
  const destination = resolveInside(saveRoot, path.join(saveRoot, worldName));
  if (await fs.pathExists(destination)) throw new Error(`Ya existe el mundo ${worldName}`);
  await fs.ensureDir(destination);
  zip.extractAllTo(destination, true);
  const nested = path.join(destination, worldName);
  if (await fs.pathExists(path.join(nested, 'level.dat'))) {
    for (const item of await fs.readdir(nested)) await fs.move(path.join(nested,item), path.join(destination,item), { overwrite: true });
    await fs.remove(nested);
  }
  return { success: true, name: worldName, path: destination };
}

async function exportInstance(instancePath) {
  const safeInstance = assertInstancePath(instancePath);
  const instanceName = safeName(path.basename(safeInstance));
  await fs.ensureDir(EXPORTS_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${instanceName}-${stamp}.zip`;
  const destination = resolveInside(EXPORTS_DIR, path.join(EXPORTS_DIR, fileName));
  const zip = new AdmZip();
  zip.addLocalFolder(safeInstance, instanceName);
  zip.writeZip(destination);
  return { success: true, name: fileName, path: destination };
}

async function openExportsFolder() {
  await fs.ensureDir(EXPORTS_DIR);
  return EXPORTS_DIR;
}

module.exports = { listWorldBackups, backupWorld, restoreWorldBackup, exportInstance, openExportsFolder, EXPORTS_DIR };
