// src/utils/secureStore.js
const Store = require('electron-store');
const { app } = require('electron');
const crypto = require('crypto');

// Clave de cifrado derivada del ID de la aplicación
const getEncryptionKey = () => {
  const appId = app.getName() || 'craftlaunch';
  return crypto.createHash('sha256').update(appId).digest();
};

// Configuración del store SIN esquema estricto (para evitar errores de validación)
const store = new Store({
  name: 'secure-data',
  encryptionKey: getEncryptionKey(),
  defaults: {
    tokens: {},
    user: null,
    settings: {}
  }
  // No uses 'schema' para evitar validaciones que fallen con datos previos
});

module.exports = store;