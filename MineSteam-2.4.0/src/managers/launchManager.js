/**
 * LaunchManager
 *
 * Fase 1 de la migración: fachada estable para el motor de lanzamiento legacy.
 * No modifica todavía minecraft-launcher.js para evitar regresiones.
 *
 * Próxima fase: mover aquí la construcción del comando Java y el ClasspathBuilder.
 */
const legacy = require('../launcher/minecraft-launcher');

async function launch(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('Datos de lanzamiento inválidos');
  }
  return legacy.launchMinecraft(data);
}

module.exports = { launch };
