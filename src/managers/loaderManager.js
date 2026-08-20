/**
 * LoaderManager
 *
 * Punto único de entrada para Fabric, Forge y NeoForge.
 * Los módulos específicos ya existen; esta fachada permite desacoplar
 * el launcher monolítico sin cambiar todavía su comportamiento.
 */
const fabric = require('../loaders/fabric');
const forge = require('../loaders/forge');
const neoforge = require('../loaders/neoforge');

const LOADERS = Object.freeze({ fabric, forge, neoforge });

function normalize(loader) {
  const value = String(loader || 'vanilla').trim().toLowerCase();
  if (value === 'neo-forge') return 'neoforge';
  return value;
}

function get(loader) {
  const normalized = normalize(loader);
  if (normalized === 'vanilla') return null;
  const implementation = LOADERS[normalized];
  if (!implementation) {
    throw new Error(`Loader no soportado: ${loader}`);
  }
  return implementation;
}

function supported() {
  return ['vanilla', 'fabric', 'forge', 'neoforge'];
}

async function install(loader, minecraftVersion, instanceMinecraftDir, preferredVersion, services) {
  const implementation = get(loader);
  if (!implementation) {
    return { loader: 'vanilla', version: null, profile: null, libraries: [] };
  }

  const result = await implementation.install(
    minecraftVersion,
    instanceMinecraftDir,
    preferredVersion,
    services
  );

  return { ...result, loader: normalize(loader) };
}

module.exports = { normalize, get, supported, install };
