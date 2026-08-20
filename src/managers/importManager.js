/**
 * ImportManager
 *
 * Entrada unificada para ZIP/MRPACK/CurseForge.
 */
const legacy = require('../launcher/minecraft-launcher');

async function importFile(zipPath, instanceName) {
  return legacy.importZipFile(zipPath, instanceName);
}

async function importCurseForge(zipPath, instanceName) {
  return legacy.importCurseForgeZip(zipPath, instanceName);
}

module.exports = {
  importFile,
  importCurseForge
};
