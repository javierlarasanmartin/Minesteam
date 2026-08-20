const fs = require('fs-extra');
const path = require('path');
const AdmZip = require('adm-zip');
const { assertInstancePath, assertReadableFile, resolveInside } = require('../core/security');

const TYPES = {
  worlds: { key: 'saves', label: 'Mundos', directory: path.join('.minecraft', 'saves'), directoriesOnly: true, installExtensions: ['.zip'] },
  resourcepacks: { key: 'resourcepacks', label: 'Resource Packs', directory: path.join('.minecraft', 'resourcepacks'), directoriesOnly: false, installExtensions: ['.zip'] },
  shaders: { key: 'shaderpacks', label: 'Shaders', directory: path.join('.minecraft', 'shaderpacks'), directoriesOnly: false, installExtensions: ['.zip'] }
};

function getTypeConfig(type) {
  const config = TYPES[String(type || '').toLowerCase()];
  if (!config) throw new Error('Tipo de contenido no soportado');
  return config;
}

function getDirectory(instancePath, type) {
  const safeInstance = assertInstancePath(instancePath);
  const config = getTypeConfig(type);
  return resolveInside(safeInstance, path.join(safeInstance, config.directory));
}

function safeName(name) {
  const value = String(name || '').trim();
  if (!value || value === '.' || value === '..' || /[\\/]/.test(value)) {
    throw new Error('Nombre de archivo o carpeta inválido');
  }
  return value;
}

async function getSize(target) {
  const stat = await fs.stat(target);
  if (stat.isFile()) return stat.size;
  let total = 0;
  for (const name of await fs.readdir(target)) total += await getSize(path.join(target, name));
  return total;
}

async function list(instancePath, type) {
  const config = getTypeConfig(type);
  const directory = getDirectory(instancePath, type);
  await fs.ensureDir(directory);
  const names = await fs.readdir(directory);
  const items = [];

  for (const name of names) {
    if (name.startsWith('.')) continue;
    const fullPath = resolveInside(directory, path.join(directory, name));
    const stat = await fs.stat(fullPath);
    if (config.directoriesOnly && !stat.isDirectory()) continue;

    const enabled = !name.endsWith('.disabled');
    const displayName = enabled ? name : name.slice(0, -'.disabled'.length);
    items.push({
      name: displayName,
      fileName: name,
      enabled,
      isDirectory: stat.isDirectory(),
      size: await getSize(fullPath),
      modifiedAt: stat.mtime.toISOString(),
      type: config.key
    });
  }

  return items.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

async function remove(instancePath, type, name) {
  const safeNameValue = safeName(name);
  const directory = getDirectory(instancePath, type);
  const target = resolveInside(directory, path.join(directory, safeNameValue));
  if (!fs.existsSync(target)) throw new Error('Elemento no encontrado');
  await fs.remove(target);
  return { success: true };
}

async function rename(instancePath, type, oldName, newName) {
  const oldSafe = safeName(oldName);
  const newSafe = safeName(newName);
  const directory = getDirectory(instancePath, type);
  const source = resolveInside(directory, path.join(directory, oldSafe));
  const target = resolveInside(directory, path.join(directory, newSafe));
  if (!fs.existsSync(source)) throw new Error('Elemento no encontrado');
  if (fs.existsSync(target)) throw new Error('Ya existe un elemento con ese nombre');
  await fs.move(source, target);
  return { success: true, name: newSafe };
}

async function toggle(instancePath, type, name, enabled) {
  const config = getTypeConfig(type);
  if (config.directoriesOnly) throw new Error('Los mundos no se pueden desactivar');
  const safeNameValue = safeName(name);
  const directory = getDirectory(instancePath, type);
  const current = resolveInside(directory, path.join(directory, safeNameValue));
  if (!fs.existsSync(current)) throw new Error('Elemento no encontrado');

  const base = safeNameValue.endsWith('.disabled') ? safeNameValue.slice(0, -'.disabled'.length) : safeNameValue;
  const targetName = enabled ? base : (base.endsWith('.disabled') ? base : `${base}.disabled`);
  const target = resolveInside(directory, path.join(directory, targetName));
  if (current !== target && fs.existsSync(target)) throw new Error('Ya existe un elemento con el nombre destino');
  if (current !== target) await fs.move(current, target);
  return { success: true, enabled: Boolean(enabled), fileName: targetName };
}

async function installFile(instancePath, type, sourcePath) {
  const config = getTypeConfig(type);
  const safeSource = assertReadableFile(sourcePath, config.installExtensions);
  const directory = getDirectory(instancePath, type);
  await fs.ensureDir(directory);
  const fileName = path.basename(safeSource);
  const destination = resolveInside(directory, path.join(directory, fileName));
  if (fs.existsSync(destination)) throw new Error(`Ya existe ${fileName}`);
  await fs.copyFile(safeSource, destination);
  return { success: true, name: fileName, path: destination };
}

async function importWorld(instancePath, sourcePath) {
  const safeSource = assertReadableFile(sourcePath, ['.zip']);
  const directory = getDirectory(instancePath, 'worlds');
  await fs.ensureDir(directory);
  const zip = new AdmZip(safeSource);
  const entries = zip.getEntries();
  if (!entries.length) throw new Error('El ZIP del mundo está vacío');

  const topLevels = new Set(entries.map(entry => entry.entryName.split('/')[0]).filter(Boolean));
  const archiveBase = path.basename(safeSource, path.extname(safeSource));
  const destinationName = safeName(topLevels.size === 1 ? [...topLevels][0] : archiveBase);
  const destination = resolveInside(directory, path.join(directory, destinationName));
  if (fs.existsSync(destination)) throw new Error(`Ya existe el mundo ${destinationName}`);

  await fs.ensureDir(destination);
  zip.extractAllTo(destination, true);

  const nested = path.join(destination, destinationName);
  if (await fs.pathExists(path.join(nested, 'level.dat'))) {
    const contents = await fs.readdir(nested);
    for (const item of contents) await fs.move(path.join(nested, item), path.join(destination, item), { overwrite: true });
    await fs.remove(nested);
  }

  return { success: true, name: destinationName };
}

async function openFolder(instancePath, type) {
  const directory = getDirectory(instancePath, type);
  await fs.ensureDir(directory);
  return directory;
}

module.exports = {
  TYPES,
  list,
  remove,
  rename,
  toggle,
  installFile,
  importWorld,
  openFolder
};
