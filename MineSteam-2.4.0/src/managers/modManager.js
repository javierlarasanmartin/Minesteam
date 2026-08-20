/**
 * ModManager
 *
 * API de dominio para mods individuales.
 * La lógica de descarga existente sigue en minecraft-launcher.js durante
 * esta fase; aquí se estabiliza el contrato para extraerla posteriormente.
 */
const legacy = require('../launcher/minecraft-launcher');
const modrinth = require('../mods/modrinthMods');

async function search(query, limit, filters) {
  return legacy.searchModrinthMods(query, limit, filters);
}

async function get(projectId) {
  return legacy.getModrinthMod(projectId);
}

async function install(data) {
  return legacy.installModrinthMod(data);
}

async function list(instancePath) {
  return legacy.listInstanceMods(instancePath);
}

async function remove(instancePath, fileName) {
  return legacy.removeInstanceMod(instancePath, fileName);
}

module.exports = {
  normalizeLoader: modrinth.normalizeLoader,
  search,
  get,
  install,
  list,
  remove
};
