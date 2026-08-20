const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');

const USER_AGENT = 'MineSteam/3.0.0';
const FABRIC_META_BASE = 'https://meta.fabricmc.net/v2';

const REQUEST_CONFIG = {
  timeout: 30000,
  headers: {
    'User-Agent': USER_AGENT,
    Accept: 'application/json'
  }
};

/**
 * Obtiene el perfil oficial de Fabric para una versión de Minecraft.
 *
 * @param {string} minecraftVersion
 * @param {string|null} loaderVersion
 * @returns {Promise<object>}
 */
async function getProfile(minecraftVersion, loaderVersion = null) {
  if (!minecraftVersion) {
    throw new Error('No se especificó la versión de Minecraft');
  }

  const minecraft = String(minecraftVersion).trim();

  const base =
    `${FABRIC_META_BASE}/versions/loader/${encodeURIComponent(minecraft)}`;

  const url = loaderVersion
    ? `${base}/${encodeURIComponent(String(loaderVersion).trim())}/profile/json`
    : `${base}/profile/json`;

  let lastError = null;

  for (const timeout of [20000, 30000, 45000]) {
    try {
      const response = await axios.get(url, {
        ...REQUEST_CONFIG,
        timeout
      });

      const profile = response.data;

      if (!profile || typeof profile !== 'object') {
        throw new Error('Fabric Meta devolvió una respuesta vacía');
      }

      if (!profile.id) {
        throw new Error('El perfil de Fabric no contiene un ID válido');
      }

      if (!profile.mainClass) {
        throw new Error('El perfil de Fabric no contiene mainClass');
      }

      if (!Array.isArray(profile.libraries)) {
        throw new Error('El perfil de Fabric no contiene libraries válidas');
      }

      return profile;
    } catch (error) {
      lastError = error;

      logger.warn(
        `No se pudo obtener el perfil Fabric para Minecraft ${minecraft} ` +
        `(intento con timeout ${timeout} ms): ${error.message}`
      );
    }
  }

  throw lastError || new Error(
    `Fabric Meta no respondió para Minecraft ${minecraft}`
  );
}

/**
 * Obtiene las versiones de Fabric Loader disponibles
 * para una versión determinada de Minecraft.
 *
 * @param {string} minecraftVersion
 * @returns {Promise<Array>}
 */
async function getAvailableVersions(minecraftVersion) {
  if (!minecraftVersion) {
    throw new Error('No se especificó la versión de Minecraft');
  }

  const minecraft = String(minecraftVersion).trim();

  const url =
    `${FABRIC_META_BASE}/versions/loader/${encodeURIComponent(minecraft)}`;

  let lastError = null;

  for (const timeout of [20000, 35000, 50000]) {
    try {
      const response = await axios.get(url, {
        ...REQUEST_CONFIG,
        timeout
      });

      const entries = Array.isArray(response.data)
        ? response.data
        : [];

      /*
       * Fabric Meta devuelve normalmente:
       *
       * [
       *   {
       *     loader: {
       *       separator: ".",
       *       build: 3,
       *       maven: "...",
       *       version: "0.19.3",
       *       stable: true
       *     },
       *     intermediary: {...},
       *     launcherMeta: {...}
       *   }
       * ]
       *
       * Aquí normalizamos la respuesta una sola vez.
       */
      const normalized = entries
        .map(entry => ({
          version: entry?.loader?.version
            ? String(entry.loader.version)
            : null,

          stable: Boolean(entry?.loader?.stable),

          build: Number(entry?.loader?.build || 0)
        }))
        .filter(entry => entry.version);

      if (normalized.length > 0) {
        return normalized;
      }

      logger.warn(
        `Fabric Meta respondió correctamente, pero no devolvió ` +
        `loaders para Minecraft ${minecraft}`
      );

      lastError = new Error(
        `No hay versiones de Fabric disponibles para Minecraft ${minecraft}`
      );

      break;
    } catch (error) {
      lastError = error;

      logger.warn(
        `Error consultando Fabric Meta para Minecraft ${minecraft} ` +
        `(timeout ${timeout} ms): ${error.message}`
      );
    }
  }

  /*
   * Fallback local.
   *
   * Se utiliza únicamente si Fabric Meta no responde.
   *
   * IMPORTANTE:
   * Estos valores no sustituyen la API oficial.
   * Antes de instalar se vuelve a solicitar el perfil oficial.
   */
  const fallback = {
    '26.2': [
      '0.19.3'
    ],

    '26.1.2': [
      '0.19.3'
    ],

    '26.1': [
      '0.19.3'
    ],

    '1.21.1': [
      '0.18.1',
      '0.17.3',
      '0.16.14'
    ],

    '1.21': [
      '0.16.14',
      '0.16.10'
    ],

    '1.20.6': [
      '0.16.10',
      '0.15.11'
    ],

    '1.20.4': [
      '0.15.11',
      '0.15.6'
    ],

    '1.20.1': [
      '0.16.10',
      '0.15.11'
    ],

    '1.19.2': [
      '0.16.10',
      '0.14.21'
    ]
  };

  const fallbackVersions = fallback[minecraft];

  if (Array.isArray(fallbackVersions) && fallbackVersions.length > 0) {
    logger.warn(
      `Fabric Meta no respondió; usando catálogo de respaldo ` +
      `para Minecraft ${minecraft}`
    );

    return fallbackVersions.map((version, index) => ({
      version,
      stable: index === 0,
      build: 0
    }));
  }

  throw lastError || new Error(
    `Fabric no está disponible para Minecraft ${minecraft}`
  );
}

/**
 * Selecciona la mejor versión disponible de Fabric.
 *
 * Prioridad:
 * 1. preferredVersion si existe.
 * 2. Loader estable con mayor build.
 * 3. Primer loader disponible.
 *
 * @param {Array} versions
 * @param {string|null} preferredVersion
 * @returns {object}
 */
function selectLoaderVersion(versions, preferredVersion = null) {
  if (!Array.isArray(versions) || versions.length === 0) {
    throw new Error('No existen versiones de Fabric disponibles');
  }

  const normalizedPreferred = preferredVersion
    ? String(preferredVersion).trim()
    : null;

  if (normalizedPreferred) {
    const preferred = versions.find(
      entry => String(entry.version) === normalizedPreferred
    );

    if (preferred) {
      return preferred;
    }
  }

  const stableVersions = versions
    .filter(entry => entry.stable)
    .sort((a, b) => {
      const buildA = Number(a.build || 0);
      const buildB = Number(b.build || 0);

      return buildB - buildA;
    });

  if (stableVersions.length > 0) {
    return stableVersions[0];
  }

  return versions[0];
}

/**
 * Instala Fabric dentro de una instancia.
 *
 * @param {string} minecraftVersion
 * @param {string} instanceMinecraftDir
 * @param {string|null} preferredVersion
 * @param {object} services
 * @returns {Promise<object>}
 */
async function install(
  minecraftVersion,
  instanceMinecraftDir,
  preferredVersion = null,
  services = {}
) {
  if (!minecraftVersion) {
    throw new Error('No se especificó la versión de Minecraft');
  }

  if (!instanceMinecraftDir) {
    throw new Error('No se especificó el directorio de la instancia');
  }

  if (
    !services ||
    typeof services.downloadLoaderLibraries !== 'function'
  ) {
    throw new Error(
      'El servicio downloadLoaderLibraries no está disponible'
    );
  }

  const minecraft = String(minecraftVersion).trim();

  try {
    logger.info(
      `Preparando Fabric para Minecraft ${minecraft}`
    );

    /*
     * Obtener loaders disponibles.
     *
     * IMPORTANTE:
     * getAvailableVersions() ya devuelve:
     *
     * {
     *   version,
     *   stable,
     *   build
     * }
     *
     * NO debemos volver a acceder a entry.loader.version.
     */
    const versions = await getAvailableVersions(minecraft);

    if (!Array.isArray(versions) || versions.length === 0) {
      throw new Error(
        `Fabric no está disponible para Minecraft ${minecraft}`
      );
    }

    const selected = selectLoaderVersion(
      versions,
      preferredVersion
    );

    if (!selected || !selected.version) {
      throw new Error(
        `No existe un Loader Fabric válido para Minecraft ${minecraft}`
      );
    }

    if (
      preferredVersion &&
      String(selected.version) !== String(preferredVersion)
    ) {
      logger.warn(
        `Fabric ${preferredVersion} no está disponible para ` +
        `Minecraft ${minecraft}; se utilizará ${selected.version}.`
      );
    }

    logger.info(
      `Fabric Loader seleccionado: ${selected.version} ` +
      `para Minecraft ${minecraft}`
    );

    /*
     * Obtener el perfil oficial.
     *
     * Esto es especialmente importante cuando utilizamos
     * una versión proveniente del fallback.
     */
    const profile = await getProfile(
      minecraft,
      selected.version
    );

    if (!profile || !profile.id) {
      throw new Error(
        `Fabric devolvió un perfil inválido para ` +
        `${minecraft} / ${selected.version}`
      );
    }

    /*
     * Crear:
     *
     * .minecraft/versions/<fabric-profile>/
     */
    const profileDir = path.join(
      instanceMinecraftDir,
      'versions',
      profile.id
    );

    await fs.ensureDir(profileDir);

    const profilePath = path.join(
      profileDir,
      `${profile.id}.json`
    );

    await fs.writeJson(
      profilePath,
      profile,
      {
        spaces: 2
      }
    );

    logger.info(
      `Perfil Fabric guardado: ${profilePath}`
    );

    /*
     * Descargar las libraries indicadas por Fabric Meta.
     */
    const libraries =
      await services.downloadLoaderLibraries(
        profile,
        instanceMinecraftDir
      );

    logger.info(
      `Fabric Loader ${selected.version} preparado correctamente ` +
      `para Minecraft ${minecraft}`
    );

    return {
      profile,
      libraries,
      version: selected.version,
      minecraftVersion: minecraft,
      profilePath
    };
  } catch (error) {
    logger.error(
      `Error instalando Fabric para Minecraft ${minecraft}: ` +
      `${error.message}`
    );

    throw new Error(
      `Error instalando Fabric ${minecraft}: ${error.message}`
    );
  }
}

module.exports = {
  install,
  getProfile,
  getAvailableVersions
};
