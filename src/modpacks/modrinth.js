const axios = require('axios');

const MODRINTH_API = 'https://api.modrinth.com/v2';
const MODRINTH_CDN = 'https://cdn.modrinth.com';
const USER_AGENT = 'MineSteam/2.4.0';

function normalizeLoader(loader) {
  const value = String(loader || '').trim().toLowerCase();
  if (value === 'neo-forge' || value === 'neoforge') return 'neoforge';
  if (value === 'fabric') return 'fabric';
  if (value === 'forge') return 'forge';
  return 'vanilla';
}

function getLoaderType(loaders) {
  if (!Array.isArray(loaders)) return 'vanilla';
  for (const loader of loaders) {
    const normalized = normalizeLoader(loader);
    if (normalized !== 'vanilla') return normalized;
  }
  return 'vanilla';
}

function resolveLoaderFromDependencies(dependencies = {}, loaders = []) {
  if (dependencies['fabric-loader']) return {
    loader: 'fabric',
    version: dependencies['fabric-loader']
  };
  if (dependencies.neoforge) return {
    loader: 'neoforge',
    version: dependencies.neoforge
  };
  if (dependencies.forge) return {
    loader: 'forge',
    version: dependencies.forge
  };

  const loader = getLoaderType(loaders);
  return { loader, version: null };
}

async function searchModpacks(query, limit = 20, filters = {}) {
  const facets = [['project_type:modpack']];
  if (Array.isArray(filters.categories) && filters.categories.length) {
    facets.push(filters.categories.map(c => `categories:${c}`));
  }
  if (Array.isArray(filters.versions) && filters.versions.length) {
    facets.push(filters.versions.map(v => `versions:${v}`));
  }
  if (Array.isArray(filters.loaders) && filters.loaders.length) {
    facets.push(filters.loaders.map(v => `categories:${normalizeLoader(v)}`));
  }

  const response = await axios.get(`${MODRINTH_API}/search`, {
    params: { query: query || '', limit, facets: JSON.stringify(facets) },
    timeout: 15000,
    headers: { 'User-Agent': USER_AGENT }
  });

  return (response.data?.hits || []).map(hit => ({
    id: hit.project_id,
    title: hit.title,
    description: hit.description || 'Sin descripción',
    categories: hit.categories || [],
    downloads: hit.downloads || 0,
    icon: hit.icon_url ? `${MODRINTH_CDN}/${hit.icon_url}` : null,
    author: hit.author || 'Desconocido',
    slug: hit.slug,
    platform: 'modrinth',
    loaders: hit.loaders || []
  }));
}

async function getModrinthModpack(projectId) {
  const [projectRes, versionsRes] = await Promise.all([
    axios.get(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}`, { timeout: 10000, headers: { 'User-Agent': USER_AGENT } }),
    axios.get(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version`, { timeout: 10000, headers: { 'User-Agent': USER_AGENT } })
  ]);

  const project = projectRes.data;
  const versions = versionsRes.data || [];
  const stableVersions = versions.filter(v => v.version_type === 'release');
  const latestVersion = stableVersions[0] || versions[0] || null;

  return {
    id: project.id,
    title: project.title,
    description: project.description || 'Sin descripción',
    categories: project.categories || [],
    downloads: project.downloads || 0,
    icon: project.icon_url ? `${MODRINTH_CDN}/${project.icon_url}` : null,
    author: project.author || 'Desconocido',
    latestVersion,
    versions,
    gameVersions: [...new Set(versions.flatMap(v => v.game_versions || []))],
    loaders: [...new Set(versions.flatMap(v => v.loaders || []).map(normalizeLoader).filter(Boolean))],
    slug: project.slug,
    platform: 'modrinth',
    followers: project.followers || 0
  };
}

module.exports = {
  MODRINTH_API,
  MODRINTH_CDN,
  normalizeLoader,
  getLoaderType,
  resolveLoaderFromDependencies,
  searchModpacks,
  getModrinthModpack
};
