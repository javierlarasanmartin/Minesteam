/**
 * ModpackManager
 *
 * Punto único para Modrinth/CurseForge.
 * Se mantiene como adaptador durante la migración para no duplicar
 * la lógica de instalación que ya existe en el launcher.
 */
const legacy = require('../launcher/minecraft-launcher');

async function searchModrinth(query, limit, filters) {
  return legacy.searchModrinth(query, limit, filters);
}

async function getModrinth(projectId) {
  return legacy.getModrinthModpack(projectId);
}

async function install(data) {
  return legacy.installModpack(data);
}

async function importCurseForge(zipPath, instanceName) {
  return legacy.importCurseForgeZip(zipPath, instanceName);
}

module.exports = {
  searchModrinth,
  getModrinth,
  install,
  importCurseForge
};
