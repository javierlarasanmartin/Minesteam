const legacy = require('../launcher/minecraft-launcher');

const METHODS = [
  'launchMinecraft',
  'findWorkingMirror',
  'getVersionManifest',
  'getLatestMinecraftVersion',
  'getVersionList',
  'getReleaseVersionList',
  'downloadMinecraftVanilla',
  'downloadAssets',
  'downloadLibraries',
  'installFabric',
  'installForge',
  'installNeoForge',
  'crearInstanciaPersonalizada',
  'getInstances',
  'deleteInstance',
  'repairInstance',
  'duplicateInstance',
  'getInstanceDiagnostics',
  'searchModrinth',
  'getModrinthModpack',
  'installModpack',
  'searchModrinthMods',
  'getModrinthMod',
  'installModrinthMod',
  'listInstanceMods',
  'removeInstanceMod',
  'importCurseForgeZip',
  'importZipFile',
  'clearCache',
  'getCacheSize',
  'downloadJava',
  'getRequiredJavaVersion'
];

for (const method of METHODS) {
  if (typeof legacy[method] !== 'function') {
    throw new Error(`MineSteam: falta exportar "${method}" desde minecraft-launcher.js`);
  }
}

module.exports = Object.freeze(
  Object.fromEntries(METHODS.map(method => [method, (...args) => legacy[method](...args)]))
);
