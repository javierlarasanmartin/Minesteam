/**
 * JavaManager facade.
 *
 * No reemplaza src/utils/javaManager.js todavía. Sirve para que el resto
 * de la aplicación tenga un contrato estable mientras se migra.
 */
const java = require('../utils/javaManager');

function detectSystem() {
  return java.detectSystemJavaVersion();
}

function getPath(version) {
  return java.getLocalJavaPath(version);
}

async function install(version) {
  return java.downloadJava(version);
}

module.exports = {
  detectSystem,
  getPath,
  install,
  requiredVersions: Object.freeze([8, 17, 21, 25])
};
