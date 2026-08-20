const axios = require('axios');

const MODRINTH_API = 'https://api.modrinth.com/v2';
const USER_AGENT = 'MineSteam/2.4.0';

function normalizeLoader(loader) {
    const value = String(loader || '').trim().toLowerCase();
    if (value === 'neo-forge' || value === 'neoforge') return 'neoforge';
    if (value === 'fabric') return 'fabric';
    if (value === 'forge') return 'forge';
    if (value === 'quilt') return 'quilt';
    return value || null;
}

async function searchMods(query, limit = 30, filters = {}) {
    const facets = [['project_type:mod']];
    if (Array.isArray(filters.categories) && filters.categories.length) {
        facets.push(filters.categories.map(v => `categories:${v}`));
    }
    if (Array.isArray(filters.versions) && filters.versions.length) {
        facets.push(filters.versions.map(v => `versions:${v}`));
    }
    if (Array.isArray(filters.loaders) && filters.loaders.length) {
        facets.push(filters.loaders.map(v => `categories:${normalizeLoader(v)}`));
    }

    const response = await axios.get(`${MODRINTH_API}/search`, {
        params: {
            query: String(query || '').trim(),
            index: ['relevance','downloads','follows','newest','updated'].includes(filters.sort) ? filters.sort : 'relevance',
            limit: Math.max(1, Math.min(Number(limit) || 30, 100)),
            facets: JSON.stringify(facets)
        },
        timeout: 15000,
        headers: { 'User-Agent': USER_AGENT }
    });

    return (response.data?.hits || [])
        .filter(hit => hit.project_type === 'mod')
        .map(hit => ({
            id: hit.project_id,
            title: hit.title,
            slug: hit.slug,
            description: hit.description || 'Sin descripción',
            downloads: hit.downloads || 0,
            follows: hit.follows || 0,
            author: hit.author || 'Desconocido',
            icon: hit.icon_url || null,
            categories: hit.categories || [],
            loaders: (hit.loaders || []).map(normalizeLoader),
            gameVersions: hit.versions || [],
            projectType: 'mod',
            platform: 'modrinth'
        }));
}

async function getMod(projectId) {
    const [projectResponse, versionsResponse] = await Promise.all([
        axios.get(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}`, {
            timeout: 15000,
            headers: { 'User-Agent': USER_AGENT }
        }),
        axios.get(`${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version`, {
            timeout: 15000,
            headers: { 'User-Agent': USER_AGENT }
        })
    ]);

    const project = projectResponse.data;
    if (project.project_type !== 'mod') {
        throw new Error(`El proyecto ${project.title || projectId} no es un mod`);
    }

    return {
        ...project,
        versions: Array.isArray(versionsResponse.data) ? versionsResponse.data : []
    };
}

async function resolveCompatibleVersion(projectId, versionId, gameVersion, loader) {
    const versions = (await getMod(projectId)).versions;
    const normalizedLoader = normalizeLoader(loader);

    if (versionId) {
        const exact = versions.find(v => v.id === versionId);
        if (exact) return exact;
    }

    const compatible = versions.filter(version => {
        if (gameVersion && !version.game_versions?.includes(gameVersion)) return false;
        if (normalizedLoader && normalizedLoader !== 'vanilla') {
            const loaders = (version.loaders || []).map(normalizeLoader);
            if (!loaders.includes(normalizedLoader)) return false;
        }
        return Array.isArray(version.files) && version.files.length > 0;
    });

    compatible.sort((a, b) => {
        const releaseA = a.version_type === 'release' ? 1 : 0;
        const releaseB = b.version_type === 'release' ? 1 : 0;
        if (releaseA !== releaseB) return releaseB - releaseA;
        return new Date(b.date_published || 0) - new Date(a.date_published || 0);
    });

    return compatible[0] || null;
}

module.exports = {
    normalizeLoader,
    searchMods,
    getMod,
    resolveCompatibleVersion
};
