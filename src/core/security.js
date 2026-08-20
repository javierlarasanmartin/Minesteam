const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');

const INSTANCES_DIR = path.join(app.getPath('userData'), 'instances');

function resolveInside(root, candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new Error('Ruta inválida');
  }

  const rootResolved = path.resolve(root);
  const candidateResolved = path.resolve(candidate);

  if (
    candidateResolved !== rootResolved &&
    !candidateResolved.startsWith(rootResolved + path.sep)
  ) {
    throw new Error('La ruta está fuera del directorio permitido');
  }

  return candidateResolved;
}

function assertInstancePath(instancePath, options = {}) {
  const safePath = resolveInside(INSTANCES_DIR, instancePath);
  if (options.mustExist !== false && !fs.existsSync(safePath)) {
    throw new Error('La instancia no existe');
  }
  return safePath;
}

function assertReadableFile(filePath, allowedExtensions = []) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    throw new Error('Archivo inválido');
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error('El archivo no existe');
  if (!fs.statSync(resolved).isFile()) throw new Error('La ruta no corresponde a un archivo');

  if (allowedExtensions.length) {
    const ext = path.extname(resolved).toLowerCase();
    const allowed = allowedExtensions.map(x => x.toLowerCase());
    if (!allowed.includes(ext)) throw new Error(`Extensión no permitida: ${ext}`);
  }

  return resolved;
}

module.exports = { INSTANCES_DIR, resolveInside, assertInstancePath, assertReadableFile };
