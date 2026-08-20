const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const { assertInstancePath, resolveInside } = require('../core/security');

const API = 'https://api.modrinth.com/v2';
const USER_AGENT = 'MineSteam/2.4.0';

const PROJECT_TYPES = {
  resourcepacks: 'resourcepack',
  shaders: 'shader'
};

function normalizeType(type) {
  const value = String(type || '').toLowerCase();
  if (!PROJECT_TYPES[value]) throw new Error('Tipo de contenido Modrinth no soportado');
  return value;
}

function getMinecraftVersion(instancePath) {
  const safe = assertInstancePath(instancePath);
  const candidates = [
    path.join(safe, 'version.json'),
    path.join(safe, '.minesteam', 'instance.json'),
    path.join(safe, 'instance.json')
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    try {
      const data = fs.readJsonSync(file);
      return data.minecraftVersion || data.gameVersion || data.game_versions?.[0] || data.game?.version || null;
    } catch (_) {}
  }
  return null;
}

async function search(type, query = '', limit = 20, offset = 0, gameVersion = null) {
  const normalized = normalizeType(type);
  const facets = [[`project_type:${PROJECT_TYPES[normalized]}`]];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  const response = await axios.get(`${API}/search`, {
    params: {
      query: String(query || '').trim(),
      limit: Math.min(Math.max(Number(limit) || 20, 1), 100),
      offset: Math.max(Number(offset) || 0, 0),
      facets: JSON.stringify(facets)
    },
    timeout: 15000,
    headers: { 'User-Agent': USER_AGENT }
  });
  return {
    total: response.data?.total_hits || 0,
    hits: (response.data?.hits || []).map(hit => ({
      id: hit.project_id,
      title: hit.title,
      slug: hit.slug,
      description: hit.description || 'Sin descripción',
      downloads: hit.downloads || 0,
      followers: hit.follows || 0,
      icon: hit.icon_url || null,
      author: hit.author || 'Desconocido',
      categories: hit.categories || [],
      versions: hit.versions || [],
      projectType: PROJECT_TYPES[normalized]
    }))
  };
}

async function getVersions(projectId, gameVersion = null) {
  const params = {};
  if (gameVersion) params.game_versions = JSON.stringify([gameVersion]);
  const response = await axios.get(`${API}/project/${encodeURIComponent(projectId)}/version`, {
    params,
    timeout: 15000,
    headers: { 'User-Agent': USER_AGENT }
  });
  return response.data || [];
}

async function install(instancePath, type, projectId, versionId = null) {
  const normalized = normalizeType(type);
  const safeInstance = assertInstancePath(instancePath);
  const gameVersion = getMinecraftVersion(safeInstance);
  let versions = await getVersions(projectId, gameVersion);
  if (!versions.length && gameVersion) versions = await getVersions(projectId);
  if (!versions.length) throw new Error('No existe una versión compatible de este proyecto');

  const version = versionId ? versions.find(v => v.id === versionId) : null;
  const selected = version || versions.find(v => v.version_type === 'release') || versions[0];
  if (!selected) throw new Error('No se encontró una versión instalable');

  if (gameVersion && Array.isArray(selected.game_versions) && selected.game_versions.length && !selected.game_versions.includes(gameVersion)) {
    throw new Error(`La versión ${selected.version_number} no es compatible con Minecraft ${gameVersion}`);
  }

  const file = selected.files?.find(f => f.primary) || selected.files?.[0];
  if (!file?.url) throw new Error('Modrinth no proporcionó un archivo descargable');

  const directory = path.join(safeInstance, '.minecraft', normalized === 'resourcepacks' ? 'resourcepacks' : 'shaderpacks');
  await fs.ensureDir(directory);
  const fileName = path.basename(new URL(file.url).pathname) || `${selected.name || projectId}.zip`;
  const destination = resolveInside(directory, path.join(directory, fileName));
  if (await fs.pathExists(destination)) {
    return { success: true, alreadyInstalled: true, file: fileName, version: selected.version_number, gameVersion };
  }

  const temp = `${destination}.part`;
  try {
    const response = await axios.get(file.url, { responseType: 'arraybuffer', timeout: 30000, headers: { 'User-Agent': USER_AGENT } });
    await fs.writeFile(temp, response.data);
    if (file.hashes?.sha512) {
      const crypto = require('crypto');
      const hash = crypto.createHash('sha512').update(response.data).digest('hex');
      if (hash.toLowerCase() !== file.hashes.sha512.toLowerCase()) throw new Error('La verificación SHA-512 del archivo falló');
    }
    await fs.move(temp, destination);
    return { success: true, file: fileName, version: selected.version_number, versionId: selected.id, gameVersion, projectId };
  } catch (error) {
    await fs.remove(temp).catch(() => {});
    throw error;
  }
}

module.exports = { search, getVersions, install, getMinecraftVersion };
