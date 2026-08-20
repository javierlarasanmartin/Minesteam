const fabric = require('./fabric');
const forge = require('./forge');
const neoforge = require('./neoforge');

const LOADERS = Object.freeze({
  vanilla: null,
  fabric,
  forge,
  neoforge
});

function normalizeLoader(value) {
  const loader = String(value || 'vanilla').trim().toLowerCase();
  if (loader === 'neo-forge') return 'neoforge';
  if (loader === 'neoforge') return 'neoforge';
  if (loader === 'fabric') return 'fabric';
  if (loader === 'forge') return 'forge';
  return 'vanilla';
}

function isSupported(loader) {
  return Object.prototype.hasOwnProperty.call(LOADERS, normalizeLoader(loader));
}

async function getAvailableVersions(loader, minecraftVersion) {
  const normalized = normalizeLoader(loader);
  if (normalized === 'vanilla') return [];
  const mc = String(minecraftVersion || '').trim();
  if (!mc || mc === 'latest') return [];
  const implementation = LOADERS[normalized];
  if (!implementation) throw new Error(`Loader no soportado: ${loader}`);
  if (typeof implementation.getAvailableVersions !== 'function') return [];

  try {
    const result = await implementation.getAvailableVersions(mc);
    return Array.isArray(result) ? result : [];
  } catch (error) {
    // No ocultamos el error: el renderer puede mostrar un mensaje útil,
    // pero mantenemos un resultado vacío para que una caída temporal de
    // Maven/Meta no rompa la ventana de creación de instancias.
    try {
      const logger = require('../utils/logger');
      logger.warn(`No se pudieron consultar versiones ${normalized} para Minecraft ${mc}: ${error.message}`);
    } catch (_) {}
    return [];
  }
}

async function install(loader, minecraftVersion, instanceMinecraftDir, preferredVersion, services) {
  const normalized = normalizeLoader(loader);
  if (normalized === 'vanilla') return null;

  const implementation = LOADERS[normalized];
  if (!implementation) throw new Error(`Loader no soportado: ${loader}`);

  return implementation.install(
    minecraftVersion,
    instanceMinecraftDir,
    preferredVersion || null,
    services
  );
}

module.exports = {
  LOADERS,
  normalizeLoader,
  isSupported,
  install,
  getAvailableVersions
};
