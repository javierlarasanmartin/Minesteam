// src/launcher/minecraft-launcher.js

const path = require('path');
const PATH_SEPARATOR = process.platform === 'win32' ? ';' : ':';
const fs = require('fs-extra');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const axios = require('axios');
const https = require('https');
const http = require('http');
const AdmZip = require('adm-zip');
const extract = require('extract-zip');
const { app, BrowserWindow } = require('electron');

const store = require('../utils/secureStore');
const logger = require('../utils/logger');
const pLimit = require('p-limit');
const downloadConcurrency = pLimit(24);
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 48, maxFreeSockets: 24 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 48, maxFreeSockets: 24 });
const activeDownloads = new Map();
const javaManager = require('../utils/javaManager');
const modrinthMods = require('../mods/modrinthMods');
const modrinth = require('../modpacks/modrinth');
const { assertInstancePath, resolveInside } = require('../core/security');
const libraryManager = require('../minecraft/libraryManager');
const classpathBuilder = require('../minecraft/classpathBuilder');
const loaderManager = require('../loaders/loaderManager');

// ============================================
// CONSTANTES Y RUTAS
// ============================================

const INSTANCES_DIR = path.join(app.getPath('userData'), 'instances');
const CACHE_DIR = path.join(app.getPath('userData'), 'cache');

const ASSETS_CACHE = path.join(CACHE_DIR, 'assets');
const LIBRARIES_CACHE = path.join(CACHE_DIR, 'libraries');
const JAVA_CACHE = path.join(CACHE_DIR, 'java');

const BUNDLED_VERSIONS_DIR = path.join(
    process.resourcesPath || path.join(__dirname, '..', '..'),
    'bundled_versions'
);

fs.ensureDirSync(INSTANCES_DIR);
fs.ensureDirSync(CACHE_DIR);
fs.ensureDirSync(ASSETS_CACHE);
fs.ensureDirSync(LIBRARIES_CACHE);
fs.ensureDirSync(JAVA_CACHE);

// ============================================
// URLs
// ============================================

const activeMirror = {
    name: 'Mojang (directo)',
    librariesUrl: 'https://libraries.minecraft.net/',
    manifestUrl:
        'https://launchermeta.mojang.com/mc/game/version_manifest.json'
};

const MODRINTH_API = 'https://api.modrinth.com/v2';

// ============================================
// PROGRESO
// ============================================

function sendProgress(stage, current, total, message = '') {
    try {
        const mainWindow =
            BrowserWindow.getFocusedWindow() ||
            BrowserWindow.getAllWindows()[0];

        if (!mainWindow) return;

        const progress =
            total > 0
                ? Math.max(0, Math.min(100, Math.round((current / total) * 100)))
                : 0;

        mainWindow.webContents.send('download-progress', {
            stage,
            current,
            total,
            progress,
            message
        });
        mainWindow.webContents.send('terminal-log', {
            level: 'info',
            source: 'launcher',
            message: `[${stage}] ${message || `${current}/${total}`}`,
            progress,
            timestamp: new Date().toISOString()
        });
    } catch (_) {
        // La ventana puede haberse cerrado.
    }
}

// ============================================
// UTILIDADES
// ============================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeName(name) {
    if (!name) return 'instancia';

    return String(name)
        .replace(/[\\/:\*?"<>|()\s]/g, '_')
        .trim() || 'instancia';
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function generateOfflineUUID(username) {
    const digest = crypto
        .createHash('md5')
        .update(`OfflinePlayer:${username}`, 'utf8')
        .digest();

    digest[6] = (digest[6] & 0x0f) | 0x30;
    digest[8] = (digest[8] & 0x3f) | 0x80;

    const hex = digest.toString('hex');

    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20)
    ].join('-');
}

function detectJavaVersion() {
    try {
        const output = execSync('java -version 2>&1', {
            encoding: 'utf8'
        });

        const match = output.match(/version\s+"(\d+)(?:\.\d+)?/i);

        if (match) {
            return parseInt(match[1], 10);
        }
    } catch (_) {
        // Java no está instalado o no está en PATH.
    }

    return 0;
}

function getPlatformName() {
    if (process.platform === 'win32') return 'windows';
    if (process.platform === 'darwin') return 'osx';
    return 'linux';
}

function ensureInsideDirectory(root, target) {
    const rootResolved = path.resolve(root);
    const targetResolved = path.resolve(target);

    return (
        targetResolved === rootResolved ||
        targetResolved.startsWith(rootResolved + path.sep)
    );
}

function sha1File(filePath) {
    const hash = crypto.createHash('sha1');
    const data = fs.readFileSync(filePath);
    return hash.update(data).digest('hex');
}

function copyFromCache(cachePath, destPath) {
    try {
        if (!fs.existsSync(cachePath)) return false;

        const stat = fs.statSync(cachePath);

        if (!stat.isFile() || stat.size <= 0) {
            fs.removeSync(cachePath);
            return false;
        }

        fs.ensureDirSync(path.dirname(destPath));
        fs.copyFileSync(cachePath, destPath);

        return true;
    } catch (error) {
        logger.warn(`Error copiando desde caché: ${error.message}`);
        return false;
    }
}

// ============================================
// MIRROR
// ============================================

async function findWorkingMirror() {
    return activeMirror;
}

// ============================================
// MANIFEST DE MINECRAFT
// ============================================

const FALLBACK_RELEASE_VERSIONS = [
    '26.2', '26.1', '1.21.11', '1.21.10', '1.21.9', '1.21.8', '1.21.7',
    '1.21.6', '1.21.5', '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.21',
    '1.20.6', '1.20.5', '1.20.4', '1.20.3', '1.20.2', '1.20.1', '1.20',
    '1.19.4', '1.19.3', '1.19.2', '1.19.1', '1.19', '1.18.2', '1.18.1',
    '1.18', '1.17.1', '1.17', '1.16.5', '1.16.4', '1.16.3', '1.16.2',
    '1.16.1', '1.15.2', '1.15.1', '1.15', '1.14.4', '1.14.3', '1.14.2',
    '1.14.1', '1.14', '1.13.2', '1.13.1', '1.13', '1.12.2', '1.12.1',
    '1.12', '1.11.2', '1.11.1', '1.11', '1.10.2', '1.10', '1.9.4',
    '1.9.3', '1.9.2', '1.9', '1.8.9', '1.8.8', '1.8.7', '1.8', '1.7.10',
    '1.7.9', '1.7.8', '1.7.2', '1.6.4', '1.6.2', '1.5.2', '1.4.7',
    '1.3.2', '1.2.5', '1.1', '1.0'
];

function getFallbackManifest() {
    return {
        latest: { release: FALLBACK_RELEASE_VERSIONS[0], snapshot: FALLBACK_RELEASE_VERSIONS[0] },
        versions: FALLBACK_RELEASE_VERSIONS.map(id => ({
            id, type: 'release', releaseTime: null, url: null
        }))
    };
}

async function getVersionManifest() {
    try {
        const response = await axios.get(activeMirror.manifestUrl, {
            timeout: 20000,
            headers: {
                'User-Agent': 'MineSteam/2.4.0',
                'Accept': 'application/json'
            }
        });

        if (!response.data || !Array.isArray(response.data.versions)) {
            throw new Error('El manifest de Mojang no tiene un formato válido');
        }

        return response.data;
    } catch (error) {
        logger.warn(`No se pudo obtener el manifest de Mojang; usando catálogo local: ${error.message}`);
        return getFallbackManifest();
    }
}

async function getLatestMinecraftVersion() {
    const manifest = await getVersionManifest();

    if (!manifest.latest?.release) {
        throw new Error('Mojang no indicó la última versión estable');
    }

    return manifest.latest.release;
}

async function getVersionList() {
    const manifest = await getVersionManifest();

    return manifest.versions
        .map(version => version.id)
        .filter(Boolean);
}

async function getReleaseVersionList() {
    const manifest = await getVersionManifest();
    return manifest.versions
        .filter(version => version && version.type === 'release')
        .map(version => ({
            id: version.id,
            type: version.type,
            releaseTime: version.releaseTime || null,
            url: version.url || null
        }))
        .filter(version => version.id);
}

// ============================================
// DESCARGAS
// ============================================

async function downloadFile(
    url,
    destPath,
    retries = 3,
    progressCallback = null
) {
    if (!url) throw new Error('URL de descarga vacía');

    if (fs.existsSync(destPath)) {
        try {
            const stat = fs.statSync(destPath);
            if (stat.isFile() && stat.size > 0) return true;
            fs.removeSync(destPath);
        } catch (_) {}
    }

    const key = path.resolve(destPath);
    if (activeDownloads.has(key)) return activeDownloads.get(key);

    const task = (async () => {
        fs.ensureDirSync(path.dirname(destPath));
        const temporaryPath = `${destPath}.part`;

        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                if (fs.existsSync(temporaryPath)) fs.removeSync(temporaryPath);

                const response = await axios({
                    method: 'GET',
                    url,
                    responseType: 'stream',
                    timeout: 180000,
                    maxRedirects: 10,
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                    decompress: true,
                    httpsAgent,
                    httpAgent,
                    headers: {
                        'User-Agent': 'MineSteam/2.4.0',
                        'Accept': '*/*',
                        'Connection': 'keep-alive'
                    }
                });

                const totalLength = Number(response.headers['content-length']) || 0;
                let downloaded = 0;
                const writer = fs.createWriteStream(temporaryPath, { highWaterMark: 1024 * 1024 });

                response.data.on('data', chunk => {
                    downloaded += chunk.length;
                    if (progressCallback) progressCallback(downloaded, totalLength);
                });

                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                    response.data.on('error', reject);
                    response.data.pipe(writer);
                });

                const stat = fs.statSync(temporaryPath);
                if (stat.size <= 0) throw new Error('El servidor devolvió un archivo vacío');

                fs.moveSync(temporaryPath, destPath, { overwrite: true });
                return true;
            } catch (error) {
                logger.warn(`Descarga fallida ${path.basename(destPath)} (${attempt}/${retries}): ${error.message}`);
                try { if (fs.existsSync(temporaryPath)) fs.removeSync(temporaryPath); } catch (_) {}
                if (attempt < retries) await sleep(Math.min(1000 * attempt, 3000));
            }
        }
        return false;
    })();

    activeDownloads.set(key, task);
    try { return await task; }
    finally { activeDownloads.delete(key); }
}

// ============================================
// HASH DEL CLIENTE
// ============================================

async function getClientHash(version) {
    const manifest = await getVersionManifest();

    const info = manifest.versions.find(v => v.id === version);

    if (!info) {
        throw new Error(`Versión ${version} no encontrada`);
    }

    const response = await axios.get(info.url, {
        timeout: 20000
    });

    return response.data?.downloads?.client?.sha1 || null;
}

// ============================================
// LIBRERÍAS - REGLAS
// ============================================

function libraryAllowedByCurrentOS(rules) {
    if (!Array.isArray(rules) || rules.length === 0) {
        return true;
    }

    const currentOS = getPlatformName();

    let allowed = false;
    let hasAllowRule = false;

    for (const rule of rules) {
        if (!rule || typeof rule !== 'object') continue;

        const ruleOS = rule.os?.name;

        const matchesOS =
            !ruleOS ||
            ruleOS === currentOS;

        if (!matchesOS) continue;

        if (rule.action === 'allow') {
            allowed = true;
            hasAllowRule = true;
        }

        if (rule.action === 'disallow') {
            return false;
        }
    }

    return hasAllowRule ? allowed : true;
}

function selectNativeClassifier(lib) {
    const classifiers = lib?.downloads?.classifiers || {};

    const preferred =
        process.platform === 'win32'
            ? [
                'natives-windows-64',
                'natives-windows',
                'natives-windows-x86'
            ]
            : process.platform === 'darwin'
                ? [
                    'natives-osx',
                    'natives-macos'
                ]
                : [
                    'natives-linux'
                ];

    for (const key of preferred) {
        if (classifiers[key]) {
            return classifiers[key];
        }
    }

    for (const [key, value] of Object.entries(classifiers)) {
        const lower = key.toLowerCase();

        if (!lower.includes('natives')) continue;

        if (
            process.platform === 'win32' &&
            lower.includes('windows')
        ) {
            return value;
        }

        if (
            process.platform === 'darwin' &&
            (lower.includes('osx') || lower.includes('mac'))
        ) {
            return value;
        }

        if (
            process.platform === 'linux' &&
            lower.includes('linux')
        ) {
            return value;
        }
    }

    return null;
}

// ============================================
// MINECRAFT VANILLA
// ============================================

async function downloadMinecraftVanilla(
    minecraftVersion,
    instanceMinecraftDir
) {
    const versionDir = path.join(
        instanceMinecraftDir,
        'versions',
        minecraftVersion
    );

    const jarPath = path.join(
        versionDir,
        `${minecraftVersion}.jar`
    );

    const jsonPath = path.join(
        versionDir,
        `${minecraftVersion}.json`
    );

    // Ya instalado.
    if (
        fs.existsSync(jarPath) &&
        fs.existsSync(jsonPath)
    ) {
        const stats = fs.statSync(jarPath);

        if (stats.size > 0) {
            logger.info(
                `✅ Minecraft ${minecraftVersion} ya existe ` +
                `(${(stats.size / 1024 / 1024).toFixed(2)} MB)`
            );

            return true;
        }

        fs.removeSync(jarPath);
    }

    fs.ensureDirSync(versionDir);

    // ========================================
    // BUNDLED VERSION
    // ========================================

    const bundledDir = path.join(
        BUNDLED_VERSIONS_DIR,
        minecraftVersion
    );

    const bundledJar = path.join(
        bundledDir,
        `${minecraftVersion}.jar`
    );

    const bundledJson = path.join(
        bundledDir,
        `${minecraftVersion}.json`
    );

    if (
        fs.existsSync(bundledJar) &&
        fs.existsSync(bundledJson)
    ) {
        fs.copyFileSync(bundledJar, jarPath);
        fs.copyFileSync(bundledJson, jsonPath);

        logger.info(
            `📁 Minecraft ${minecraftVersion} copiado desde bundled_versions`
        );

        return true;
    }

    // ========================================
    // MANIFEST
    // ========================================

    sendProgress(
        'minecraft',
        0,
        2,
        `Preparando Minecraft ${minecraftVersion}...`
    );

    const manifest = await getVersionManifest();

    const versionInfo = manifest.versions.find(
        version => version.id === minecraftVersion
    );

    if (!versionInfo) {
        throw new Error(
            `La versión ${minecraftVersion} no existe en el manifest de Mojang`
        );
    }

    const jsonResponse = await axios.get(
        versionInfo.url,
        {
            timeout: 20000,
            headers: {
                'User-Agent': 'MineSteam/2.4.0'
            }
        }
    );

    const versionJson = jsonResponse.data;

    if (!versionJson) {
        throw new Error(
            `Mojang devolvió un JSON vacío para ${minecraftVersion}`
        );
    }

    fs.writeJsonSync(
        jsonPath,
        versionJson,
        { spaces: 2 }
    );

    sendProgress(
        'minecraft',
        1,
        2,
        `Descargando cliente ${minecraftVersion}...`
    );

    // ========================================
    // CLIENT JAR
    // ========================================

    let clientUrl =
        versionJson.downloads?.client?.url || null;

    // Compatibilidad con versiones extremadamente antiguas.
    if (!clientUrl) {
        clientUrl =
            `https://s3.amazonaws.com/Minecraft.Download/versions/` +
            `${minecraftVersion}/${minecraftVersion}.jar`;

        logger.warn(
            `⚠️ ${minecraftVersion} no tiene downloads.client; ` +
            `probando repositorio histórico de Minecraft`
        );
    }

    const downloaded = await downloadFile(
        clientUrl,
        jarPath,
        5
    );

    if (!downloaded) {
        throw new Error(
            `No se pudo descargar ${minecraftVersion}.jar`
        );
    }

    const jarStats = fs.statSync(jarPath);

    if (jarStats.size <= 0) {
        throw new Error(
            `${minecraftVersion}.jar quedó vacío`
        );
    }

    // ========================================
    // SERVER JAR PARA VERSIONES ANTIGUAS
    // ========================================

    const serverUrl =
        versionJson.downloads?.server?.url ||
        (
            /^1\.(\d+)(?:\.(\d+))?$/.test(minecraftVersion) &&
            parseInt(minecraftVersion.split('.')[1], 10) <= 12
                ? `https://s3.amazonaws.com/Minecraft.Download/versions/` +
                  `${minecraftVersion}/${minecraftVersion}_server.jar`
                : null
        );

    if (serverUrl) {
        const serverPath = path.join(
            versionDir,
            `${minecraftVersion}-server.jar`
        );

        await downloadFile(
            serverUrl,
            serverPath,
            3
        ).catch(error => {
            logger.warn(
                `⚠️ No se pudo descargar server.jar de ${minecraftVersion}: ` +
                error.message
            );
        });
    }

    sendProgress(
        'minecraft',
        2,
        2,
        'Minecraft listo'
    );

    return true;
}

// ============================================
// IDIOMAS / RECURSO DE COMPATIBILIDAD
// ============================================

const MINESTEAM_LANGUAGE_NAMES = {
    en_us: ['English (US)', 'United States'],
    en_gb: ['English (UK)', 'United Kingdom'],
    es_es: ['Español (España)', 'España'],
    es_mx: ['Español (México)', 'México'],
    es_ar: ['Español (Argentina)', 'Argentina'],
    es_cl: ['Español (Chile)', 'Chile'],
    es_ec: ['Español (Ecuador)', 'Ecuador'],
    es_uy: ['Español (Uruguay)', 'Uruguay'],
    es_ve: ['Español (Venezuela)', 'Venezuela'],
    pt_br: ['Português (Brasil)', 'Brasil'],
    pt_pt: ['Português (Portugal)', 'Portugal'],
    fr_fr: ['Français', 'France'],
    fr_ca: ['Français (Canada)', 'Canada'],
    de_de: ['Deutsch', 'Deutschland'],
    it_it: ['Italiano', 'Italia'],
    ja_jp: ['日本語', '日本'],
    ko_kr: ['한국어', '대한민국'],
    zh_cn: ['简体中文', '中国'],
    zh_tw: ['繁體中文', '台灣'],
    ru_ru: ['Русский', 'Россия'],
    uk_ua: ['Українська', 'Україна'],
    pl_pl: ['Polski', 'Polska'],
    nl_nl: ['Nederlands', 'Nederland'],
    tr_tr: ['Türkçe', 'Türkiye'],
    sv_se: ['Svenska', 'Sverige'],
    da_dk: ['Dansk', 'Danmark'],
    fi_fi: ['Suomi', 'Suomi'],
    nb_no: ['Norsk Bokmål', 'Norge'],
    cs_cz: ['Čeština', 'Česko'],
    hu_hu: ['Magyar', 'Magyarország'],
    ro_ro: ['Română', 'România'],
    el_gr: ['Ελληνικά', 'Ελλάδα'],
    bg_bg: ['Български', 'България'],
    sk_sk: ['Slovenčina', 'Slovensko'],
    hr_hr: ['Hrvatski', 'Hrvatska'],
    sl_si: ['Slovenščina', 'Slovenija'],
    ca_es: ['Català', 'Catalunya'],
    eu_es: ['Euskara', 'Euskal Herria'],
    gl_es: ['Galego', 'Galicia'],
    he_il: ['עברית', 'ישראל'],
    ar_sa: ['العربية', 'العربية'],
    hi_in: ['हिन्दी', 'भारत'],
    id_id: ['Bahasa Indonesia', 'Indonesia'],
    ms_my: ['Bahasa Melayu', 'Malaysia'],
    vi_vn: ['Tiếng Việt', 'Việt Nam'],
    th_th: ['ไทย', 'ประเทศไทย']
};

function getResourcePackFormat(minecraftVersion) {
    const v = String(minecraftVersion || '');
    const exact = {
        '1.21': 34, '1.21.1': 34,
        '1.21.2': 42, '1.21.3': 42,
        '1.21.4': 46, '1.21.5': 55,
        '1.21.6': 63, '1.21.7': 64, '1.21.8': 64,
        '1.21.9': 69, '1.21.10': 69, '1.21.11': 75,
        '26.1': 84, '26.1.1': 84, '26.1.2': 84,
        '26.2': 88
    };
    if (exact[v]) return exact[v];
    if (/^1\.20\.5|^1\.20\.6/.test(v)) return 32;
    if (/^1\.20\.([1-4])$/.test(v)) return 22;
    if (/^1\.19/.test(v)) return 13;
    return 34;
}

function updateOptionsResourcePack(instanceMinecraftDir) {
    const optionsPath = path.join(instanceMinecraftDir, 'options.txt');
    let text = '';
    try { if (fs.existsSync(optionsPath)) text = fs.readFileSync(optionsPath, 'utf8'); } catch (_) {}
    const pack = 'file/MineSteam-Languages';
    const regex = /^resourcePacks:(.*)$/m;
    let packs = ['vanilla'];
    const match = text.match(regex);
    if (match) {
        try {
            const parsed = JSON.parse(match[1]);
            if (Array.isArray(parsed)) packs = parsed.map(String);
        } catch (_) {}
    }
    if (!packs.includes('vanilla')) packs.unshift('vanilla');
    if (!packs.includes(pack)) packs.push(pack);
    const line = `resourcePacks:${JSON.stringify(packs)}`;
    if (regex.test(text)) text = text.replace(regex, line);
    else text += `${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
    try { fs.writeFileSync(optionsPath, text, 'utf8'); } catch (_) {}
}

function ensureLanguageResourcePack(minecraftVersion, instanceMinecraftDir, indexData) {
    const objects = indexData?.objects || {};
    const languageEntries = Object.entries(objects).filter(([name]) => {
        const normalized = String(name).replace(/\\/g, '/').toLowerCase();
        return normalized.startsWith('minecraft/lang/') && normalized.endsWith('.json');
    });
    if (!languageEntries.length) return { count: 0, path: null };

    const packRoot = path.join(instanceMinecraftDir, 'resourcepacks', 'MineSteam-Languages');
    const langRoot = path.join(packRoot, 'assets', 'minecraft', 'lang');
    fs.ensureDirSync(langRoot);
    const languageMeta = {};
    let copied = 0;

    for (const [assetName, object] of languageEntries) {
        const hash = object?.hash;
        if (!hash || hash.length < 2) continue;
        const source = path.join(instanceMinecraftDir, 'assets', 'objects', hash.substring(0, 2), hash);
        if (!fs.existsSync(source) || fs.statSync(source).size <= 0) continue;
        const code = path.basename(assetName, '.json').toLowerCase();
        const destination = path.join(langRoot, `${code}.json`);
        try {
            fs.copyFileSync(source, destination);
            const meta = MINESTEAM_LANGUAGE_NAMES[code] || [`Minecraft (${code})`, code];
            languageMeta[code] = { name: meta[0], region: meta[1], bidirectional: ['ar_sa', 'he_il'].includes(code) };
            copied++;
        } catch (_) {}
    }

    const packFormat = getResourcePackFormat(minecraftVersion);
    const packDefinition = packFormat >= 65
        ? {
            min_format: [packFormat, 0],
            max_format: [packFormat, 0],
            description: 'MineSteam - Idiomas de Minecraft',
            language: languageMeta
        }
        : {
            pack_format: packFormat,
            description: 'MineSteam - Idiomas de Minecraft',
            language: languageMeta
        };
    const packMeta = { pack: packDefinition };
    fs.writeJsonSync(path.join(packRoot, 'pack.mcmeta'), packMeta, { spaces: 2 });
    updateOptionsResourcePack(instanceMinecraftDir);
    return { count: copied, path: packRoot };
}

// ============================================
// ASSETS
// ============================================

async function downloadAssets(
    minecraftVersion,
    instanceMinecraftDir
) {
    const versionDir = path.join(instanceMinecraftDir, 'versions', minecraftVersion);
    const jsonPath = path.join(versionDir, `${minecraftVersion}.json`);
    if (!fs.existsSync(jsonPath)) throw new Error(`Falta el JSON de Minecraft ${minecraftVersion}`);

    const versionJson = fs.readJsonSync(jsonPath);
    const assetsId = versionJson.assetIndex?.id || versionJson.assets || minecraftVersion;
    const assetsUrl = versionJson.assetIndex?.url;
    const assetsSha1 = versionJson.assetIndex?.sha1 || null;
    const assetsDir = path.join(instanceMinecraftDir, 'assets');
    const indexesDir = path.join(assetsDir, 'indexes');
    const objectsDir = path.join(assetsDir, 'objects');
    fs.ensureDirSync(indexesDir);
    fs.ensureDirSync(objectsDir);
    if (!assetsUrl) throw new Error(`Minecraft ${minecraftVersion} no proporciona assetIndex`);

    const indexPath = path.join(indexesDir, `${assetsId}.json`);
    const indexValid = () => {
        try {
            if (!fs.existsSync(indexPath) || fs.statSync(indexPath).size <= 0) return false;
            if (assetsSha1 && sha1File(indexPath).toLowerCase() !== assetsSha1.toLowerCase()) return false;
            const data = fs.readJsonSync(indexPath);
            return data && typeof data.objects === 'object';
        } catch (_) { return false; }
    };
    if (!indexValid()) {
        try { fs.removeSync(indexPath); } catch (_) {}
        const ok = await downloadFile(assetsUrl, indexPath, 5);
        if (!ok || !indexValid()) throw new Error(`No se pudo validar el índice de assets ${assetsId}`);
    }

    const indexData = fs.readJsonSync(indexPath);
    const entries = Object.entries(indexData.objects || {});
    const languageEntries = entries.filter(([assetPath]) => {
        const normalized = String(assetPath).replace(/\\/g, '/').toLowerCase();
        return normalized.startsWith('minecraft/lang/') && normalized.endsWith('.json');
    });
    logger.info(`🌐 Índice ${assetsId}: ${languageEntries.length} archivos de idioma detectados.`);

    let completed = 0;
    sendProgress('assets', 0, Math.max(1, entries.length), `Descargando ${entries.length} assets...`);
    await Promise.all(entries.map(([assetName, object]) => downloadConcurrency(async () => {
        const hash = object?.hash;
        if (!hash || hash.length < 2) throw new Error(`Asset sin hash: ${assetName}`);
        const subPath = hash.substring(0, 2);
        const objectPath = path.join(objectsDir, subPath, hash);
        const cachePath = path.join(ASSETS_CACHE, subPath, hash);
        const expectedSize = Number(object?.size || 0);
        let valid = false;
        const check = file => {
            try {
                if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
                const stat = fs.statSync(file);
                if (stat.size <= 0 || (expectedSize > 0 && stat.size !== expectedSize)) return false;
                return sha1File(file).toLowerCase() === hash.toLowerCase();
            } catch (_) { return false; }
        };
        valid = check(objectPath);
        if (!valid && check(cachePath)) {
            fs.ensureDirSync(path.dirname(objectPath));
            fs.copyFileSync(cachePath, objectPath);
            valid = true;
        }
        if (!valid) {
            try { fs.removeSync(objectPath); } catch (_) {}
            const url = `https://resources.download.minecraft.net/${subPath}/${hash}`;
            const ok = await downloadFile(url, objectPath, 5);
            if (!ok || !check(objectPath)) {
                try { fs.removeSync(objectPath); } catch (_) {}
                throw new Error(`No se pudo verificar asset ${assetName}`);
            }
            fs.ensureDirSync(path.dirname(cachePath));
            fs.copyFileSync(objectPath, cachePath);
        }
        completed++;
        if (completed % 25 === 0 || completed === entries.length) sendProgress('assets', completed, entries.length, `Assets: ${completed}/${entries.length}`);
    })));

    // Fallback robusto: además del asset index oficial, generamos un pequeño
    // resource pack activo con los idiomas vanilla. Así Minecraft puede
    // descubrir y mostrar los idiomas incluso cuando una instalación externa
    // trae un asset index incompleto o una configuración antigua.
    const languagePack = ensureLanguageResourcePack(minecraftVersion, instanceMinecraftDir, indexData);
    if (languagePack.count > 0) logger.info(`🌐 MineSteam Languages: ${languagePack.count} idiomas disponibles.`);
    else logger.warn(`⚠️ No se pudieron materializar los idiomas vanilla de ${minecraftVersion}.`);

    sendProgress('assets', entries.length, entries.length, `Assets completos · ${languagePack.count} idiomas disponibles`);
    return { success: true, assets: entries.length, languages: languagePack.count, languagePack: languagePack.path };
}

// ============================================
// LIBRERÍAS VANILLA
// ============================================

async function downloadLibraries(
    minecraftVersion,
    instanceMinecraftDir
) {
    const versionDir = path.join(
        instanceMinecraftDir,
        'versions',
        minecraftVersion
    );

    const jsonPath = path.join(
        versionDir,
        `${minecraftVersion}.json`
    );

    if (!fs.existsSync(jsonPath)) {
        return [];
    }

    const versionJson = fs.readJsonSync(jsonPath);

    const allLibraries = [];

    for (const lib of versionJson.libraries || []) {
        if (
            lib.rules &&
            !libraryAllowedByCurrentOS(lib.rules)
        ) {
            continue;
        }

        // Artifact normal.
        if (
            lib.downloads?.artifact?.path &&
            lib.downloads?.artifact?.url
        ) {
            allLibraries.push({
                type: 'artifact',
                path: lib.downloads.artifact.path,
                url: lib.downloads.artifact.url
            });
        }

        // Native.
        const native = selectNativeClassifier(lib);

        if (
            native?.path &&
            native?.url
        ) {
            allLibraries.push({
                type: 'native',
                path: native.path,
                url: native.url
            });
        }
    }

    const librariesDir = path.join(
        instanceMinecraftDir,
        'libraries'
    );

    const nativesDir = path.join(
        versionDir,
        'natives'
    );

    fs.ensureDirSync(librariesDir);
    fs.ensureDirSync(nativesDir);

    const total = allLibraries.length;

    sendProgress(
        'libraries',
        0,
        total,
        `Descargando ${total} librerías...`
    );

    const result = [];
    let completed = 0;

    // Las librerías son independientes: descargarlas en paralelo reduce
    // mucho el tiempo total de instalación.
    await Promise.all(allLibraries.map(lib => downloadConcurrency(async () => {
        const libraryPath = path.join(librariesDir, lib.path);
        const cachePath = path.join(LIBRARIES_CACHE, lib.path);

        if (!fs.existsSync(libraryPath)) {
            if (!copyFromCache(cachePath, libraryPath)) {
                const url = String(lib.url).replace(
                    'https://libraries.minecraft.net/',
                    activeMirror.librariesUrl
                );
                const ok = await downloadFile(url, libraryPath, 5);
                if (!ok) throw new Error(`No se pudo descargar la librería ${lib.path}`);
                fs.ensureDirSync(path.dirname(cachePath));
                fs.copyFileSync(libraryPath, cachePath);
            }
        }

        if (lib.type === 'native' && fs.existsSync(libraryPath)) {
            try {
                const zip = new AdmZip(libraryPath);
                zip.extractAllTo(nativesDir, true);
            } catch (error) {
                logger.warn(`⚠️ No se pudo extraer native ${lib.path}: ${error.message}`);
            }
        }

        // IMPORTANTE: devolver/agregar la ruta es necesario para que estas
        // librerías formen parte del classpath final. Antes se descargaban
        // correctamente pero `result` quedaba vacío, dejando fuera Log4j y
        // otras librerías vanilla al iniciar Fabric.
        result.push(libraryPath);

        completed++;
        if (completed % 10 === 0 || completed === total) {
            sendProgress('libraries', completed, total, `Librerías: ${completed}/${total}`);
        }
        return libraryPath;
    })));

    sendProgress(
        'libraries',
        total,
        total,
        'Librerías completas'
    );

    return result;
}

// ============================================
// MINESTEAM 3.0 - CLIENTE SRG DE NEOFORGE
// ============================================
// NeoForge necesita el cliente remapeado SRG en el classpath
// para que las clases de Minecraft cliente estén disponibles.

function findNeoForgeSrgClient(instanceRoot, minecraftVersion) {
    const librariesRoot = path.join(instanceRoot, '.minecraft', 'libraries');
    if (!fs.existsSync(librariesRoot)) return null;

    const candidates = [];

    function scan(dir, depth = 0) {
        if (depth > 8) return;

        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const full = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                scan(full, depth + 1);
                continue;
            }

            if (!entry.name.toLowerCase().endsWith('-srg.jar')) continue;

            if (
                entry.name.startsWith(`client-${minecraftVersion}-`) &&
                entry.name.includes('-srg.jar')
            ) {
                candidates.push(full);
            }
        }
    }

    scan(librariesRoot);

    if (!candidates.length) return null;

    candidates.sort((a, b) => {
        try {
            return fs.statSync(b).size - fs.statSync(a).size;
        } catch {
            return 0;
        }
    });

    return candidates[0];
}

function addNeoForgeSrgClientToClasspath(classpath, instanceRoot, minecraftVersion) {
    const srg = findNeoForgeSrgClient(instanceRoot, minecraftVersion);

    if (!srg) {
        logger.warn(
            `⚠️ No se encontró client-${minecraftVersion}-*-srg.jar para NeoForge`
        );
        return classpath;
    }

    const normalized = path.resolve(srg);

    if (!classpath.some(p => path.resolve(p) === normalized)) {
        classpath.push(srg);
        logger.info(
            `✅ Cliente NeoForge SRG incluido en classpath: ${path.basename(srg)}`
        );
    }

    return classpath;
}


// ============================================
// LIBRERÍAS DE LOADER (FABRIC / FORGE / NEOFORGE)
// ============================================
//
// Los perfiles de los loaders no siempre usan el mismo formato que
// el manifest vanilla de Mojang. Esta función normaliza:
//
//   downloads.artifact
//   downloads.classifiers
//   name (coordenadas Maven)
//   url/path explícitos
//
// y mantiene las librerías dentro de .minecraft/libraries.

function mavenCoordinateToPath(name, classifier = null, extension = 'jar') {
    if (!name || typeof name !== 'string') return null;

    const parts = name.split(':');

    if (parts.length < 3) return null;

    const group = parts[0];
    const artifact = parts[1];
    const version = parts[2];

    if (!group || !artifact || !version) return null;

    // Un coordinate puede venir como:
    // group:artifact:version
    // group:artifact:version:classifier
    // group:artifact:version:packaging:classifier
    let resolvedClassifier = classifier;

    if (!resolvedClassifier && parts.length === 4) {
        resolvedClassifier = parts[3];
    }

    if (!resolvedClassifier && parts.length >= 5) {
        resolvedClassifier = parts[4];
    }

    const fileName =
        `${artifact}-${version}` +
        (resolvedClassifier ? `-${resolvedClassifier}` : '') +
        `.${extension}`;

    return path.join(
        ...group.split('.'),
        artifact,
        version,
        fileName
    );
}

function normalizeLibraryArtifact(lib, artifact, type = 'artifact') {
    if (!artifact || typeof artifact !== 'object') {
        return null;
    }

    let relativePath = artifact.path || null;
    let url = artifact.url || null;

    // Algunos perfiles solo proporcionan name.
    if (!relativePath && lib?.name) {
        const classifier =
            type === 'native'
                ? null
                : artifact.classifier || null;

        relativePath =
            mavenCoordinateToPath(
                lib.name,
                classifier,
                artifact.extension || 'jar'
            );
    }

    // Resolver el repositorio Maven correcto cuando el perfil no trae URL
    // o cuando trae una URL genérica de libraries.minecraft.net para una
    // dependencia que realmente vive en Maven Fabric/Maven Central.
    if (relativePath) {
        const normalizedPath = relativePath.replace(/\\/g, '/');
        const group = String(lib?.name || '').split(':')[0] || '';

        let repositoryUrl = activeMirror.librariesUrl;

        if (group === 'net.fabricmc' || group.startsWith('net.fabricmc.')) {
            repositoryUrl = 'https://maven.fabricmc.net/';
        } else if (group === 'org.ow2.asm' || group.startsWith('org.ow2.asm.')) {
            repositoryUrl = 'https://repo1.maven.org/maven2/';
        } else if (group === 'org.spongepowered' || group.startsWith('org.spongepowered.')) {
            repositoryUrl = 'https://repo1.maven.org/maven2/';
        }

        const generatedUrl =
            `${repositoryUrl.replace(/\/?$/, '/')}${normalizedPath}`;

        // Si no hay URL, o la URL apunta al repositorio vanilla para una
        // coordenada externa, usar el repositorio calculado.
        if (!url || (
            /libraries\.minecraft\.net/i.test(url) &&
            group && group !== 'com.mojang' &&
            !group.startsWith('com.mojang.')
        )) {
            url = generatedUrl;
        }
    }

    if (!relativePath || !url) {
        return null;
    }

    return {
        type,
        path: relativePath,
        url,
        sha1: artifact.sha1 || null,
        size: Number.isFinite(Number(artifact.size))
            ? Number(artifact.size)
            : null
    };
}

async function downloadLoaderLibraries(profile, instanceMinecraftDir) {
    return libraryManager.resolveProfileLibraries({
        profile,
        instanceMinecraftDir,
        cacheDir: LIBRARIES_CACHE,
        downloadFile,
        sendProgress
    });
}

// ============================================
// JAVA
// ============================================

async function getRequiredJavaVersion(
    minecraftVersion
) {
    return String(
        await javaManager.resolveRequiredJavaVersion(
            minecraftVersion
        )
    );
}

async function downloadJava(version) {
    const required = Number(version);

    if (![8, 16, 17, 21, 25].includes(required)) {
        throw new Error(`Versión de Java no soportada: ${version}`);
    }

    const systemVersion = javaManager.detectSystemJavaVersion();

    if (systemVersion === required) {
        logger.info(
            `Java ${systemVersion} detectado y coincide con Java ${required} requerido`
        );
        return 'java';
    }

    const localJava = javaManager.getLocalJavaPath(required);

    if (localJava) {
        logger.info(`Java ${required} encontrado en runtime local: ${localJava}`);
        return localJava;
    }

    logger.info(`Java ${required} no está disponible. Descargando runtime administrado por MineSteam...`);

    const executable = await javaManager.downloadJava(required);

    if (!executable) {
        throw new Error(`javaManager no devolvió un ejecutable para Java ${required}`);
    }

    return executable;
}

// ============================================
// LOADERS
// ============================================
// La implementación de los loaders vive ahora en src/loaders/.
// Se mantienen estas funciones wrapper para conservar el API interno
// del launcher y no romper instalaciones existentes.


async function installFabric(
    minecraftVersion,
    instanceMinecraftDir,
    preferredVersion = null
) {
    return loaderManager.install(
        'fabric',
        minecraftVersion,
        instanceMinecraftDir,
        preferredVersion,
        {
            downloadFile,
            downloadLoaderLibraries,
            getRequiredJavaVersion,
            downloadJava
        }
    );
}

async function installForge(
    minecraftVersion,
    instanceMinecraftDir,
    preferredVersion = null
) {
    return loaderManager.install(
        'forge',
        minecraftVersion,
        instanceMinecraftDir,
        preferredVersion,
        {
            downloadFile,
            downloadLoaderLibraries,
            getRequiredJavaVersion,
            downloadJava
        }
    );
}

async function installNeoForge(
    minecraftVersion,
    instanceMinecraftDir,
    preferredVersion = null
) {
    return loaderManager.install(
        'neoforge',
        minecraftVersion,
        instanceMinecraftDir,
        preferredVersion,
        {
            downloadFile,
            downloadLoaderLibraries,
            getRequiredJavaVersion,
            downloadJava
        }
    );
}

async function getLoaderVersionList(loader, minecraftVersion) {
    const normalized = loaderManager.normalizeLoader(loader);
    if (normalized === 'vanilla' || !minecraftVersion) return [];
    return loaderManager.getAvailableVersions(normalized, minecraftVersion);
}

// ============================================
// INSTANCIA PERSONALIZADA
// ============================================

async function crearInstanciaPersonalizada(data) {
    const {
        nombre,
        version,
        ram = 4096,
        loaderVersion = null
    } = data;

    const loader = loaderManager.normalizeLoader(data?.loader || 'vanilla');

    if (!version) {
        return {
            success: false,
            error: 'No se indicó una versión de Minecraft'
        };
    }

    const nombreLimpio =
        sanitizeName(nombre);

    const instanceDir =
        path.join(
            INSTANCES_DIR,
            nombreLimpio
        );

    if (fs.existsSync(instanceDir)) {
        return {
            success: false,
            error:
                'Ya existe una instancia con ese nombre'
        };
    }

    fs.ensureDirSync(instanceDir);

    const minecraftDir =
        path.join(
            instanceDir,
            '.minecraft'
        );

    fs.ensureDirSync(minecraftDir);

    const versionJson = {
        name: nombreLimpio,
        minecraftVersion: version,
        loader,
        loaderVersion: loaderVersion || null,
        ram: Math.max(1024, Math.min(65536, Number(ram) || 4096)),
        gameVersions: [version],
        installedAt:
            new Date().toISOString(),
        type: 'custom'
    };

    fs.writeJsonSync(
        path.join(
            instanceDir,
            'version.json'
        ),
        versionJson,
        { spaces: 2 }
    );

    await downloadMinecraftVanilla(
        version,
        minecraftDir
    );

    await downloadAssets(
        version,
        minecraftDir
    );

    await downloadLibraries(
        version,
        minecraftDir
    );

    let loaderInfo = null;

    if (loader === 'fabric') {
        loaderInfo =
            await installFabric(
                version,
                minecraftDir,
                loaderVersion
            );
    } else if (loader === 'forge') {
        loaderInfo =
            await installForge(
                version,
                minecraftDir,
                loaderVersion
            );
    } else if (loader === 'neoforge') {
        loaderInfo =
            await installNeoForge(
                version,
                minecraftDir,
                loaderVersion
            );
    }

    if (loaderInfo?.version) {
        versionJson.loaderVersion =
            loaderInfo.version;

        fs.writeJsonSync(
            path.join(
                instanceDir,
                'version.json'
            ),
            versionJson,
            { spaces: 2 }
        );
    }

    return {
        success: true,
        path: instanceDir,
        loaderJar: loaderInfo
    };
}

// ============================================
// PERFILES DE LOADER
// ============================================

function findLoaderProfile(
    instanceMinecraftDir,
    loader,
    loaderVersion,
    minecraftVersion
) {
    const versionsDir =
        path.join(
            instanceMinecraftDir,
            'versions'
        );

    if (!fs.existsSync(versionsDir)) {
        return null;
    }

    const candidates = [];

    for (
        const directory
        of fs.readdirSync(versionsDir)
    ) {
        const jsonPath =
            path.join(
                versionsDir,
                directory,
                `${directory}.json`
            );

        if (!fs.existsSync(jsonPath)) {
            continue;
        }

        const lower =
            directory.toLowerCase();

        let matches = false;

        if (loader === 'fabric') {
            matches =
                lower.startsWith(
                    'fabric-loader-'
                );
        }

        if (loader === 'forge') {
            matches =
                lower.includes('forge') &&
                !lower.includes('neoforge');
        }

        if (loader === 'neoforge') {
            matches =
                lower.includes('neoforge');
        }

        if (!matches) {
            continue;
        }

        let profile = null;

        try {
            profile =
                fs.readJsonSync(
                    jsonPath
                );
        } catch (_) {
            continue;
        }

        if (
            loaderVersion &&
            !directory.includes(
                String(loaderVersion)
            ) &&
            !String(profile.id || '')
                .includes(
                    String(loaderVersion)
                )
        ) {
            continue;
        }

        if (
            minecraftVersion &&
            profile.inheritsFrom &&
            profile.inheritsFrom !==
            minecraftVersion
        ) {
            continue;
        }

        candidates.push({
            path: jsonPath,
            mtime:
                fs.statSync(
                    jsonPath
                ).mtimeMs
        });
    }

    if (!candidates.length) {
        return null;
    }

    candidates.sort(
        (a, b) =>
            b.mtime - a.mtime
    );

    return candidates[0].path;
}

// ============================================
// ARGUMENTOS DE MINECRAFT
// ============================================

function resolveMinecraftArg(
    value,
    ctx
) {
    if (value === undefined || value === null) {
        return '';
    }

    let result = String(value);

    const replacements = {
        auth_player_name:
            ctx.username,

        auth_uuid:
            ctx.uuid,

        auth_access_token:
            '0',

        auth_session:
            '0',

        user_type:
            'legacy',

        version_name:
            ctx.version,

        game_directory:
            ctx.gameDir,

        assets_root:
            ctx.assetsDir,

        assets_index_name:
            ctx.assetIndex,

        natives_directory:
            ctx.nativesDir,

        launcher_name:
            'MineSteam',

        launcher_version:
            '2.4.0',

        classpath:
            ctx.classpath,

        classpath_separator:
            path.delimiter,

        library_directory:
            path.join(
                ctx.gameDir,
                'libraries'
            ),

        auth_xuid:
            '',

        clientid:
            ''
    };

    for (
        const [key, replacement]
        of Object.entries(replacements)
    ) {
        const pattern =
            new RegExp(
                `\\$\\{${key}\\}`,
                'g'
            );

        result =
            result.replace(
                pattern,
                String(
                    replacement ?? ''
                )
            );
    }

    return result;
}

// ============================================
// REGLAS DE ARGUMENTOS
// ============================================

function argumentEntryAllowed(
    entry,
    ctx
) {
    if (!entry || typeof entry !== 'object') {
        return true;
    }

    if (
        entry.rules &&
        !libraryAllowedByCurrentOS(
            entry.rules
        )
    ) {
        return false;
    }

    // Features utilizadas por Mojang.
    const features =
        entry.features || {};

    if (
        features.is_demo_user &&
        ctx.isDemoUser !== true
    ) {
        return false;
    }

    if (
        features.has_custom_resolution &&
        ctx.hasCustomResolution !== true
    ) {
        return false;
    }

    if (
        features.has_quick_plays_support &&
        ctx.hasQuickPlaySupport !== true
    ) {
        return false;
    }

    return true;
}

// ============================================
// JVM ARGUMENTS
// ============================================

function flattenJvmArguments(
    profile,
    ctx
) {
    const result = [];

    const jvmArgs =
        profile?.arguments?.jvm;

    if (!Array.isArray(jvmArgs)) {
        return result;
    }

    for (const entry of jvmArgs) {
        if (typeof entry === 'string') {
            const value =
                resolveMinecraftArg(
                    entry,
                    ctx
                );

            if (
                value &&
                value !== '-cp' &&
                value !== '${classpath}' &&
                value !== '@${classpath}'
            ) {
                result.push(value);
            }

            continue;
        }

        if (
            !argumentEntryAllowed(
                entry,
                ctx
            )
        ) {
            continue;
        }

        const values =
            Array.isArray(entry.value)
                ? entry.value
                : [entry.value];

        for (const value of values) {
            const resolved =
                resolveMinecraftArg(
                    value,
                    ctx
                );

            if (
                resolved &&
                resolved !== '-cp' &&
                resolved !== '${classpath}' &&
                resolved !== '@${classpath}'
            ) {
                result.push(resolved);
            }
        }
    }

    return result;
}

// ============================================
// GAME ARGUMENTS
// ============================================

function flattenGameArguments(
    profile,
    ctx
) {
    const args = [];

    const gameArgs =
        profile?.arguments?.game;

    if (Array.isArray(gameArgs)) {
        for (const entry of gameArgs) {
            if (typeof entry === 'string') {
                args.push(
                    resolveMinecraftArg(
                        entry,
                        ctx
                    )
                );

                continue;
            }

            if (
                !argumentEntryAllowed(
                    entry,
                    ctx
                )
            ) {
                continue;
            }

            const values =
                Array.isArray(entry.value)
                    ? entry.value
                    : [entry.value];

            for (const value of values) {
                args.push(
                    resolveMinecraftArg(
                        value,
                        ctx
                    )
                );
            }
        }
    } else {
        // Formato antiguo.
        args.push(
            '--username',
            ctx.username,

            '--version',
            ctx.version,

            '--gameDir',
            ctx.gameDir,

            '--assetsDir',
            ctx.assetsDir,

            '--assetIndex',
            ctx.assetIndex,

            '--uuid',
            ctx.uuid,

            '--accessToken',
            '0',

            '--userType',
            'legacy',

            '--versionType',
            'release'
        );
    }

    return args.filter(
        value =>
            value !== undefined &&
            value !== null &&
            String(value) !== ''
    );
}

// ============================================
// ARGUMENT FILE DE JAVA
// ============================================

function quoteJavaArg(value) {
    const stringValue =
        String(value);

    // Java argument files utilizan espacios
    // como separadores.
    if (
        !/[\s"'#;]/.test(stringValue)
    ) {
        return stringValue;
    }

    const normalized =
        stringValue.replace(
            /\\/g,
            '/'
        );

    return `"${normalized
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')}"`;
}

function createJavaArgFile(
    instancePath,
    args
) {
    const javaArgFile =
        path.join(
            instancePath,
            'java-launch.args'
        );

    const content =
        args
            .map(quoteJavaArg)
            .join('\n') +
        '\n';

    fs.writeFileSync(
        javaArgFile,
        content,
        'utf8'
    );

    return javaArgFile;
}

// ============================================
// CLASSPATH
// ============================================


async function ensureLoaderMainClassLibrary(loader, loaderVersion, instanceMinecraftDir, libraries) {
    if (!loader || loader === 'vanilla' || !loaderVersion) return libraries;
    const normalized = String(loader).toLowerCase();
    if (normalized !== 'fabric') return libraries;
    const artifactPath = `net/fabricmc/fabric-loader/${loaderVersion}/fabric-loader-${loaderVersion}.jar`;
    const destination = path.join(instanceMinecraftDir, 'libraries', artifactPath);
    const cachePath = path.join(LIBRARIES_CACHE, artifactPath);
    const url = `https://maven.fabricmc.net/${artifactPath}`;
    fs.ensureDirSync(path.dirname(destination)); fs.ensureDirSync(path.dirname(cachePath));
    if (!fs.existsSync(destination) || fs.statSync(destination).size <= 0) {
        if (!copyFromCache(cachePath, destination)) {
            if (!await downloadFile(url, destination, 5)) throw new Error(`No se pudo descargar Fabric Loader ${loaderVersion}`);
            fs.copyFileSync(destination, cachePath);
        }
    }
    if (!libraries.map(x => path.resolve(x)).includes(path.resolve(destination))) libraries.push(destination);
    logger.info(`✓ Fabric Loader ${loaderVersion} agregado al classpath`);
    return libraries;
}

// ============================================
// LANZAMIENTO
// ============================================

async function launchMinecraft({
    instancePath,
    ram = 4096,
    resolution = {
        width: 854,
        height: 480
    },
    javaVersion = null,
    jvmArgs = '',
    auth
}) {
    sendProgress(
        'launch',
        0,
        1,
        'Preparando lanzamiento...'
    );

    const safeInstancePath = assertInstancePath(instancePath);

    const instanceMinecraftDir =
        path.join(
            safeInstancePath,
            '.minecraft'
        );

    const versionJsonPath =
        path.join(
            safeInstancePath,
            'version.json'
        );

    if (!fs.existsSync(versionJsonPath)) {
        throw new Error(
            'Instancia inválida: falta version.json'
        );
    }

    const versionData =
        fs.readJsonSync(
            versionJsonPath
        );

    const minecraftVersion =
        versionData.minecraftVersion ||
        versionData.gameVersions?.[0];

    if (!minecraftVersion) {
        throw new Error(
            'No se pudo determinar la versión de Minecraft'
        );
    }

    const loader = loaderManager.normalizeLoader(
        versionData.loader || 'vanilla'
    );

    const loaderVersion =
        versionData.loaderVersion ||
        null;

    logger.info(
        `📦 Lanzando Minecraft ${minecraftVersion} ` +
        `(${loader}${loaderVersion ? ` ${loaderVersion}` : ''})`
    );

    // ========================================
    // VANILLA
    // ========================================

    await downloadMinecraftVanilla(
        minecraftVersion,
        instanceMinecraftDir
    );

    await downloadAssets(
        minecraftVersion,
        instanceMinecraftDir
    );

    const vanillaLibraries =
        await downloadLibraries(
            minecraftVersion,
            instanceMinecraftDir
        );

    const versionDir =
        path.join(
            instanceMinecraftDir,
            'versions',
            minecraftVersion
        );

    const vanillaJsonPath =
        path.join(
            versionDir,
            `${minecraftVersion}.json`
        );

    if (!fs.existsSync(vanillaJsonPath)) {
        throw new Error(
            `No existe el perfil Vanilla ${minecraftVersion}`
        );
    }

    const vanillaProfile =
        fs.readJsonSync(
            vanillaJsonPath
        );

    // ========================================
    // JAVA
    // ========================================

    const requiredJavaVersion = Number(
        await getRequiredJavaVersion(minecraftVersion)
    );

    const selectedJavaVersion = Number(javaVersion || 0);
    if (selectedJavaVersion && selectedJavaVersion < Number(requiredJavaVersion)) {
        throw new Error(`La instancia tiene Java ${selectedJavaVersion}, pero Minecraft ${minecraftVersion} requiere Java ${requiredJavaVersion} o superior.`);
    }

    const targetJavaVersion = selectedJavaVersion || requiredJavaVersion;

    const javaExecutable =
        await downloadJava(
            targetJavaVersion
        );

    if (
        javaExecutable === 'java'
    ) {
        const systemJava =
            detectJavaVersion();

        if (
            systemJava <
            Number(requiredJavaVersion)
        ) {
            throw new Error(
                `Se requiere Java ${requiredJavaVersion}, ` +
                `pero el sistema tiene Java ` +
                `${systemJava || 'desconocido'}`
            );
        }
    }

    // ========================================
    // USUARIO
    // ========================================

    const storedUser =
        store.get('user') || {};

    const username =
        String(
            auth?.username ||
            storedUser.name ||
            'Steve'
        ).trim() || 'Steve';

    const uuid =
        String(
            auth?.uuid ||
            storedUser.uuid ||
            generateOfflineUUID(username)
        );

    // ========================================
    // DIRECTORIOS
    // ========================================

    const assetsDir =
        path.join(
            instanceMinecraftDir,
            'assets'
        );

    const vanillaNativesDir =
        path.join(
            versionDir,
            'natives'
        );

    fs.ensureDirSync(
        vanillaNativesDir
    );

    // ========================================
    // PERFIL LOADER
    // ========================================

    let profile =
        vanillaProfile;

    let loaderLibraries = [];

    if (loader === 'fabric') {
        let profilePath =
            findLoaderProfile(
                instanceMinecraftDir,
                'fabric',
                loaderVersion,
                minecraftVersion
            );

        if (!profilePath) {
            const installed =
                await installFabric(
                    minecraftVersion,
                    instanceMinecraftDir,
                    loaderVersion
                );

            profile =
                installed.profile;

            loaderLibraries =
                installed.libraries;
        } else {
            profile =
                fs.readJsonSync(
                    profilePath
                );

            loaderLibraries =
                await downloadLoaderLibraries(
                    profile,
                    instanceMinecraftDir
                );
        }
    }

    if (loader === 'forge') {
        let profilePath =
            findLoaderProfile(
                instanceMinecraftDir,
                'forge',
                loaderVersion,
                minecraftVersion
            );

        if (!profilePath) {
            const installed =
                await installForge(
                    minecraftVersion,
                    instanceMinecraftDir,
                    loaderVersion
                );

            profile =
                installed.profile;

            loaderLibraries =
                installed.libraries;
        } else {
            profile =
                fs.readJsonSync(
                    profilePath
                );

            loaderLibraries =
                await downloadLoaderLibraries(
                    profile,
                    instanceMinecraftDir
                );
        }
    }

    if (loader === 'neoforge') {
        let profilePath =
            findLoaderProfile(
                instanceMinecraftDir,
                'neoforge',
                loaderVersion,
                minecraftVersion
            );

        if (!profilePath) {
            const installed =
                await installNeoForge(
                    minecraftVersion,
                    instanceMinecraftDir,
                    loaderVersion
                );

            profile =
                installed.profile;

            loaderLibraries =
                installed.libraries;
        } else {
            profile =
                fs.readJsonSync(
                    profilePath
                );

            loaderLibraries =
                await downloadLoaderLibraries(
                    profile,
                    instanceMinecraftDir
                );
        }
    }

    // ========================================
    // ASEGURAR LIBRERÍA PRINCIPAL DEL LOADER
    // ========================================

    await ensureLoaderMainClassLibrary(
        loader,
        loaderVersion,
        instanceMinecraftDir,
        loaderLibraries
    );

    // ========================================
    // CLASSPATH FINAL
    // ========================================

    const allLibraries = [
        ...vanillaLibraries,
        ...loaderLibraries
    ];

    const classpathEntries =
        classpathBuilder.buildClasspath(
            instanceMinecraftDir,
            minecraftVersion,
            allLibraries,
            {
                // NeoForge 21.1+ carga el cliente como módulo. Incluir
                // versions/1.21.1/1.21.1.jar en el mismo classpath/module-path
                // provoca ResolutionException por paquetes exportados dos veces.
                includeMinecraftJar: loader !== 'neoforge'
            }
        );

    // Los perfiles de Forge/NeoForge tienen un JAR propio en versions/<profileId>.
    // El classpath vanilla no lo agrega automáticamente porque Minecraft vanilla
    // solo necesita versions/<minecraft>/<minecraft>.jar. Sin este JAR, Forge puede
    // terminar con código 1 aunque la instalación haya sido correcta.
    const loaderProfileId = profile?.id || null;
    if (loaderProfileId && loader !== 'vanilla') {
        const loaderJar = path.join(
            instanceMinecraftDir,
            'versions',
            loaderProfileId,
            `${loaderProfileId}.jar`
        );
        const safeLoaderJar = resolveInside(instanceMinecraftDir, loaderJar);
        if (fs.existsSync(safeLoaderJar) && fs.statSync(safeLoaderJar).isFile()) {
            const normalizedLoaderJar = path.resolve(safeLoaderJar);
            if (!classpathEntries.some(entry => path.resolve(entry) === normalizedLoaderJar)) {
                classpathEntries.unshift(normalizedLoaderJar);
                logger.info(`✓ JAR del loader agregado al classpath: ${loaderProfileId}.jar`);
            }
        } else if (loader === 'forge' || loader === 'neoforge') {
            logger.warn(`No se encontró el JAR del perfil ${loaderProfileId}; se intentará iniciar con las librerías disponibles.`);
        }
    }

    const classpath =
        classpathEntries.join(
            path.delimiter
        );

    // ========================================
    // ASSET INDEX
    // ========================================

    const assetIndex =
        vanillaProfile.assetIndex?.id ||
        vanillaProfile.assets ||
        minecraftVersion;

    // ========================================
    // NATIVES
    // ========================================

    const loaderId =
        profile.id ||
        minecraftVersion;

    const loaderVersionDir =
        path.join(
            instanceMinecraftDir,
            'versions',
            loaderId
        );

    const loaderNativesDir =
        path.join(
            loaderVersionDir,
            'natives'
        );

    const nativesDir =
        fs.existsSync(loaderNativesDir)
            ? loaderNativesDir
            : vanillaNativesDir;

    fs.ensureDirSync(
        nativesDir
    );

    // ========================================
    // CONTEXTO DE ARGUMENTOS
    // ========================================

    const ctx = {
        username,
        uuid,

        version:
            profile.id ||
            minecraftVersion,

        gameDir:
            instanceMinecraftDir,

        assetsDir,

        assetIndex,

        nativesDir,

        classpath,

        isDemoUser: false,

        hasCustomResolution:
            Boolean(
                resolution?.width &&
                resolution?.height
            ),

        hasQuickPlaySupport: false
    };

    // ========================================
    // MAIN CLASS
    // ========================================

    const mainClass =
        profile.mainClass ||
        vanillaProfile.mainClass;

    if (!mainClass) {
        throw new Error(
            `El perfil ${loader} no contiene mainClass`
        );
    }

    // Verificación temprana: evita arrancar Java con un classpath que no
    // contiene la clase principal del loader.
    if (loader === 'fabric' &&
        mainClass === 'net.fabricmc.loader.impl.launch.knot.KnotClient') {
        const hasFabricLoader =
            classpathEntries.some(entry =>
                entry.toLowerCase().endsWith(
                    `fabric-loader-${String(loaderVersion).toLowerCase()}.jar`
                )
            );

        if (!hasFabricLoader) {
            throw new Error(
                `Fabric Loader ${loaderVersion} no quedó en el classpath. ` +
                `No se puede cargar ${mainClass}.`
            );
        }
    }

    logger.info(
        `🎯 Main class: ${mainClass}`
    );

    // ========================================
    // PERFIL EFECTIVO
    // ========================================

    const effectiveProfile = {
        ...vanillaProfile,
        ...profile,

        arguments: {
            ...(vanillaProfile.arguments || {}),
            ...(profile.arguments || {})
        }
    };

    // ========================================
    // ARGUMENTOS DEL JUEGO
    // ========================================

    let gameArgs =
        flattenGameArguments(
            effectiveProfile,
            ctx
        );

    // ========================================
    // MINECRAFT ARGUMENTS ANTIGUOS
    // ========================================

    if (
        !Array.isArray(
            effectiveProfile.arguments?.game
        ) &&
        effectiveProfile.minecraftArguments
    ) {
        const legacy =
            String(
                effectiveProfile.minecraftArguments
            )
                .split(/\s+/)
                .filter(Boolean)
                .map(value =>
                    resolveMinecraftArg(
                        value,
                        ctx
                    )
                );

        gameArgs = legacy;
    }

    // ========================================
    // ARGUMENTOS OBLIGATORIOS DE MINECRAFT
    // ========================================
    // Algunos perfiles modernos de Forge/NeoForge no conservan
    // todos los argumentos vanilla en profile.arguments.game.
    // Minecraft 1.21.x exige al menos --version y --accessToken.
    // MineSteam debe proporcionarlos explícitamente para cuentas
    // offline y para evitar un cierre con MissingRequiredOptionsException.
    const ensureGameArg = (name, value) => {
        const index = gameArgs.indexOf(name);
        if (index === -1) {
            gameArgs.push(name, String(value ?? ''));
            return;
        }

        if (index === gameArgs.length - 1 ||
            String(gameArgs[index + 1] ?? '').startsWith('--')) {
            gameArgs.splice(index + 1, 0, String(value ?? ''));
        }
    };

    ensureGameArg('--version', minecraftVersion);
    ensureGameArg('--accessToken', '0');
    ensureGameArg('--username', username);
    ensureGameArg('--uuid', uuid);
    ensureGameArg('--userType', 'legacy');
    ensureGameArg('--versionType', 'release');

    // ========================================
    // RESOLUCIÓN
    // ========================================

    if (
        resolution?.width &&
        resolution?.height
    ) {
        if (
            !gameArgs.includes('--width')
        ) {
            gameArgs.push(
                '--width',
                String(resolution.width)
            );
        }

        if (
            !gameArgs.includes('--height')
        ) {
            gameArgs.push(
                '--height',
                String(resolution.height)
            );
        }
    }

    // ========================================
    // JVM ARGUMENTS
    // ========================================

    const profileJvmArgs =
        flattenJvmArguments(
            effectiveProfile,
            ctx
        );

    const customJvmArgs = (() => {
        const raw = Array.isArray(jvmArgs) ? jvmArgs.join(' ') : String(jvmArgs || '');
        const tokens = raw.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
        return tokens.map(v => v.replace(/^['"]|['"]$/g, '')).filter(Boolean).slice(0, 80);
    })();

    // ========================================
    // ARGUMENTOS FINALES
    // ========================================

    const safeRam =
        Math.max(
            512,
            Number(ram) || 4096
        );

    const initialRam =
        Math.max(
            512,
            Math.floor(
                safeRam / 4
            )
        );

    const args = [
        `-Xmx${safeRam}M`,
        `-Xms${initialRam}M`,

        `-Djava.library.path=${nativesDir}`,

        ...profileJvmArgs,
        ...customJvmArgs,

        '-cp',
        classpath,

        mainClass,

        ...gameArgs
    ];

    // ========================================
    // ELIMINAR DUPLICADOS PROBLEMÁTICOS
    // ========================================

    logger.info(
        `📚 Classpath: ${classpathEntries.length} elementos`
    );

    logger.info(
        `🧩 Argumentos JVM: ${profileJvmArgs.length}`
    );

    logger.info(
        `🎮 Argumentos Minecraft: ${gameArgs.length}`
    );

    // ========================================
    // JAVA ARG FILE
    // ========================================

    let spawnArgs = args;
    let javaArgFile = null;

    const commandLength =
        args.reduce(
            (total, value) =>
                total +
                String(value).length +
                1,
            0
        );

    /*
     * Windows tiene un límite aproximado de
     * 32767 caracteres para CreateProcess.
     *
     * Usamos un margen conservador.
     */
    const useJavaArgFile =
        process.platform === 'win32' &&
        commandLength > 24000;

    if (useJavaArgFile) {
        javaArgFile =
            createJavaArgFile(
                instancePath,
                args
            );

        spawnArgs = [
            `@${javaArgFile.replace(
                /\\/g,
                '/'
            )}`
        ];

        logger.info(
            `📄 Classpath demasiado largo ` +
            `(${commandLength} caracteres). ` +
            `Usando Java argument file.`
        );
    }

    // ========================================
    // DEBUG
    // ========================================

    const debugPath =
        path.join(
            instancePath,
            'launch_debug.json'
        );

    fs.writeJsonSync(
        debugPath,
        {
            generatedAt:
                new Date().toISOString(),

            minecraftVersion,

            loader,

            loaderVersion,

            mainClass,

            java:
                javaExecutable,

            javaRequired:
                requiredJavaVersion,

            javaSelected:
                targetJavaVersion,

            workingDirectory:
                instanceMinecraftDir,

            nativesDirectory:
                nativesDir,

            assetIndex,

            username,

            uuid,

            classpathEntries,

            classpathLength:
                classpath.length,

            args,

            usedJavaArgFile:
                useJavaArgFile,

            javaArgFile:
                javaArgFile || null,

            spawnArgs
        },
        {
            spaces: 2
        }
    );

    // ========================================
    // LANZAR JAVA
    // ========================================

    sendProgress(
        'launch',
        1,
        1,
        `Lanzando Minecraft ${minecraftVersion}...`
    );
    try {
        const mainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
        if (mainWindow) mainWindow.webContents.send('terminal-log', { level:'info', source:'minecraft', message:`Iniciando ${minecraftVersion} (${loader || 'Vanilla'})`, timestamp:new Date().toISOString() });
    } catch (_) {}

    return new Promise(
        (resolve, reject) => {
            const proc = spawn(
                javaExecutable,
                spawnArgs,
                {
                    cwd:
                        instanceMinecraftDir,

                    stdio: [
                        'ignore',
                        'pipe',
                        'pipe'
                    ],

                    shell: false,

                    env: {
                        ...process.env
                    }
                }
            );

            const runtimeLogPath =
                path.join(
                    instancePath,
                    'minecraft-runtime.log'
                );

            // Limpiar log anterior.
            try {
                fs.writeFileSync(
                    runtimeLogPath,
                    '',
                    'utf8'
                );
            } catch (_) {}

            const appendRuntimeLog =
                chunk => {
                    const text =
                        chunk.toString();

                    try {
                        fs.appendFileSync(
                            runtimeLogPath,
                            text
                        );
                    } catch (_) {}

                    const clean =
                        text.trimEnd();

                    if (clean) {
                        logger.info(clean);
                        try {
                            const mainWindow =
                                BrowserWindow.getFocusedWindow() ||
                                BrowserWindow.getAllWindows()[0];
                            if (mainWindow) {
                                for (const line of clean.split(/\r?\n/).filter(Boolean)) {
                                    const lower = line.toLowerCase();
                                    const level = lower.includes('error') || lower.includes('exception') || lower.includes('crash') ? 'error' : lower.includes('warn') ? 'warn' : 'info';
                                    mainWindow.webContents.send('terminal-log', {
                                        level,
                                        source: 'minecraft',
                                        message: line,
                                        timestamp: new Date().toISOString()
                                    });
                                }
                            }
                        } catch (_) {}
                    }
                };

            proc.stdout.on(
                'data',
                appendRuntimeLog
            );

            proc.stderr.on(
                'data',
                appendRuntimeLog
            );

            proc.on(
                'error',
                error => {
                    logger.error(
                        `❌ Error ejecutando Minecraft: ` +
                        error.message
                    );

                    reject(error);
                }
            );

            proc.on(
                'close',
                code => {
                    logger.info(`Minecraft finalizado con código ${code}`);
                    try {
                        const mainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
                        if (mainWindow) mainWindow.webContents.send('terminal-log', { level: code === 0 ? 'info' : 'error', source:'minecraft', message:`Minecraft finalizado con código ${code}`, timestamp:new Date().toISOString() });
                    } catch (_) {}

                    try {
                        const debug =
                            fs.readJsonSync(
                                debugPath
                            );

                        debug.exitCode =
                            code;

                        debug.finishedAt =
                            new Date().toISOString();

                        debug.runtimeLog =
                            runtimeLogPath;

                        fs.writeJsonSync(
                            debugPath,
                            debug,
                            {
                                spaces: 2
                            }
                        );
                    } catch (_) {}

                    if (code === 0) {
                        resolve({
                            code,
                            message:
                                'Juego cerrado'
                        });
                    } else {
                        reject(
                            new Error(
                                `Minecraft terminó con código ${code}. ` +
                                `Revisa minecraft-runtime.log`
                            )
                        );
                    }
                }
            );
        }
    );
}

// ============================================
// MODRINTH
// ============================================

async function searchModrinth(
    query,
    limit = 20,
    filters = {},
    offset = 0
) {
    try {
        const params = new URLSearchParams();
        const facets = [];

        params.set('query', String(query || '').trim());
        params.set('index', ['relevance','downloads','follows','newest','updated'].includes(filters.sort) ? filters.sort : 'relevance');
        params.set('limit', String(Math.max(1, Math.min(Number(limit) || 20, 100))));
        params.set('offset', String(Math.max(0, Number(offset) || 0)));

        // MineSteam usa esta búsqueda para instalar modpacks.
        // Por seguridad y para no mostrar mods .jar como .mrpack,
        // limitamos los resultados a proyectos cuyo tipo sea modpack.
        facets.push(['project_type:modpack']);

        if (filters.categories?.length) {
            facets.push(
                filters.categories.map(value => `categories:${value}`)
            );
        }

        if (filters.loaders?.length) {
            facets.push(
                filters.loaders.map(value => `categories:${value}`)
            );
        }

        if (filters.versions?.length) {
            facets.push(
                filters.versions.map(value => `versions:${value}`)
            );
        }

        params.set('facets', JSON.stringify(facets));

        const response = await axios.get(
            `${MODRINTH_API}/search?${params.toString()}`,
            {
                timeout: 20000,
                headers: {
                    'User-Agent': 'MineSteam/2.4.0'
                }
            }
        );

        const hits = Array.isArray(response.data?.hits)
            ? response.data.hits
            : [];

        // Segunda barrera: aunque la API responda algo inesperado,
        // nunca entregamos proyectos que no sean modpacks al instalador.
        return hits
            .filter(item => item.project_type === 'modpack')
            .map(item => ({
                ...item,
                id: item.project_id,
                title: item.title || item.slug || 'Modpack',
                description: item.description || 'Sin descripción',
                icon: item.icon_url || null,
                icon_url: item.icon_url || null,
                author: item.author || 'Desconocido',
                loaders: Array.isArray(item.categories) ? item.categories.filter(v => ['fabric','forge','neoforge','quilt'].includes(String(v).toLowerCase())).map(v => String(v).toLowerCase()) : [],
                versions: item.versions || [],
                downloads: Number(item.downloads || 0),
                follows: Number(item.follows || 0)
            }));
    } catch (error) {
        logger.error(
            `❌ Error buscando en Modrinth: ${error.message}`
        );

        return [];
    }
}

async function getModrinthModpack(
    projectId
) {
    if (!projectId) {
        return null;
    }

    try {
        const projectResponse =
            await axios.get(
                `${MODRINTH_API}/project/${encodeURIComponent(projectId)}`,
                {
                    timeout: 20000
                }
            );

        const project =
            projectResponse.data;

        if (project.project_type !== 'modpack') {
            throw new Error(
                `El proyecto de Modrinth "${project.title || project.id || projectId}" no es un modpack. ` +
                `Es de tipo "${project.project_type || 'desconocido'}".`
            );
        }

        const versionsResponse =
            await axios.get(
                `${MODRINTH_API}/project/${encodeURIComponent(projectId)}/version`,
                {
                    timeout: 20000
                }
            );

        const versions =
            (Array.isArray(versionsResponse.data) ? versionsResponse.data : [])
                .filter(version => Array.isArray(version.files) && version.files.length)
                .sort((a, b) => {
                    const releaseA = a.version_type === 'release' ? 1 : 0;
                    const releaseB = b.version_type === 'release' ? 1 : 0;
                    if (releaseA !== releaseB) return releaseB - releaseA;
                    return new Date(b.date_published || 0) - new Date(a.date_published || 0);
                });

        const validVersions = versions.filter(
            version => Array.isArray(version.files) && version.files.length > 0
        );

        if (!validVersions.length) {
            return null;
        }

        validVersions.sort(
            (a, b) =>
                new Date(
                    b.date_published
                ) -
                new Date(
                    a.date_published
                )
        );

        return {
            ...project,
            versions: validVersions,
            latestVersion:
                validVersions[0]
        };
    } catch (error) {
        logger.error(
            `❌ Error obteniendo modpack Modrinth: ` +
            error.message
        );

        return null;
    }
}

async function installModpack(data) {
    const {
        platform,
        projectId,
        versionId,
        instanceName
    } = data;

    if (
        platform === 'modrinth'
    ) {
        return installModrinthModpack(
            projectId,
            versionId,
            instanceName
        );
    }

    return {
        success: false,
        error:
            'Plataforma no soportada'
    };
}

// ============================================
// BUSCAR ARCHIVO RECURSIVO
// ============================================

function findFileRecursive(
    dir,
    filename
) {
    if (!fs.existsSync(dir)) {
        return null;
    }

    const items =
        fs.readdirSync(dir);

    for (const item of items) {
        const fullPath =
            path.join(
                dir,
                item
            );

        const stat =
            fs.statSync(fullPath);

        if (stat.isDirectory()) {
            const found =
                findFileRecursive(
                    fullPath,
                    filename
                );

            if (found) {
                return found;
            }
        } else if (
            item === filename
        ) {
            return fullPath;
        }
    }

    return null;
}

// ============================================
// INSTALAR MODPACK MODRINTH
// ============================================

async function installModrinthModpack(
    projectId,
    versionId,
    instanceName
) {
    const nombreLimpio =
        sanitizeName(instanceName);

    const instanceDir =
        path.join(
            INSTANCES_DIR,
            nombreLimpio
        );

    if (fs.existsSync(instanceDir)) {
        return {
            success: false,
            error:
                'Ya existe una instancia con ese nombre'
        };
    }

    const zipPath =
        path.join(
            INSTANCES_DIR,
            `${nombreLimpio}.mrpack`
        );

    try {
        // Nunca reutilizar un archivo de una instalación fallida anterior.
        // downloadFile() considera válido cualquier archivo no vacío.
        if (fs.existsSync(zipPath)) {
            fs.removeSync(zipPath);
        }
        sendProgress(
            'modpack',
            0,
            1,
            'Descargando modpack...'
        );

        if (!versionId) {
            throw new Error(
                'No se indicó versionId del modpack'
            );
        }

        const versionResponse =
            await axios.get(
                `${MODRINTH_API}/version/${encodeURIComponent(versionId)}`,
                {
                    timeout: 20000
                }
            );

        const version =
            versionResponse.data;

        const gameVersion =
            version.game_versions?.[0];

        if (!gameVersion) {
            throw new Error(
                'El modpack no indica una versión de Minecraft'
            );
        }

        const file =
            version.files?.find(
                item =>
                    item.primary
            ) ||
            version.files?.[0];

        if (!file?.url) {
            throw new Error(
                'No se encontró el archivo .mrpack'
            );
        }

        const downloaded =
            await downloadFile(
                file.url,
                zipPath,
                5
            );

        if (!downloaded) {
            throw new Error(
                'No se pudo descargar el modpack desde Modrinth'
            );
        }

        fs.ensureDirSync(
            instanceDir
        );

        // Un .mrpack es un ZIP con un modrinth.index.json.
        // Un mod .jar también es técnicamente un ZIP, por lo que
        // extract-zip puede abrirlo pero no encontrará el índice.
        // Validamos primero para entregar un error claro y evitar
        // extraer clases/resources de un .jar dentro de la instancia.
        let archiveEntries;

        try {
            const archive = new AdmZip(zipPath);
            archiveEntries = archive.getEntries();
        } catch (archiveError) {
            throw new Error(
                `El archivo descargado no es un ZIP/MRPACK válido: ${archiveError.message}`
            );
        }

        const hasModrinthIndex = archiveEntries.some(entry => {
            const entryName = String(entry.entryName || '')
                .replace(/\\/g, '/')
                .replace(/^\.\//, '');

            return (
                entryName === 'modrinth.index.json' ||
                entryName.endsWith('/modrinth.index.json')
            );
        });

        if (!hasModrinthIndex) {
            throw new Error(
                'El archivo descargado no es un modpack de Modrinth: ' +
                'no contiene modrinth.index.json. ' +
                'Es posible que se haya seleccionado un mod (.jar) en lugar de un modpack.'
            );
        }

        await extract(
            zipPath,
            {
                dir: instanceDir
            }
        );

        const indexPath =
            findFileRecursive(
                instanceDir,
                'modrinth.index.json'
            );

        if (!indexPath) {
            throw new Error(
                'No se encontró modrinth.index.json'
            );
        }

        const index =
            fs.readJsonSync(
                indexPath
            );

        const dependencies =
            index.dependencies || {};

        let loader =
            'vanilla';

        if (
            dependencies['fabric-loader']
        ) {
            loader = 'fabric';
        } else if (
            dependencies['neoforge']
        ) {
            loader = 'neoforge';
        } else if (
            dependencies['forge']
        ) {
            loader = 'forge';
        } else if (
            Array.isArray(version.loaders)
        ) {
            const detected =
                version.loaders.find(
                    item =>
                        ['fabric', 'forge', 'neoforge']
                            .includes(String(item).toLowerCase())
                );

            if (detected) {
                loader = loaderManager.normalizeLoader(detected);
            }
        }

        const loaderVersion =
            loader === 'fabric'
                ? dependencies['fabric-loader']
                : loader === 'forge'
                    ? dependencies['forge']
                    : loader === 'neoforge'
                        ? dependencies['neoforge']
                        : null;

        logger.info(
            `📦 Modrinth: Minecraft ${gameVersion}; ` +
            `loader=${loader}; ` +
            `loaderVersion=${loaderVersion || 'n/a'}`
        );

        // ========================================
        // NORMALIZAR RAÍZ DEL MODPACK
        // ========================================

        const indexRoot =
            path.dirname(indexPath);

        if (
            path.resolve(indexRoot) !==
            path.resolve(instanceDir)
        ) {
            const rootItems =
                fs.readdirSync(
                    indexRoot
                );

            for (
                const item
                of rootItems
            ) {
                const source =
                    path.join(
                        indexRoot,
                        item
                    );

                const destination =
                    path.join(
                        instanceDir,
                        item
                    );

                if (
                    path.resolve(source) ===
                    path.resolve(indexPath)
                ) {
                    continue;
                }

                if (
                    fs.existsSync(destination)
                ) {
                    fs.removeSync(
                        destination
                    );
                }

                fs.moveSync(
                    source,
                    destination
                );
            }
        }

        const minecraftDir =
            path.join(
                instanceDir,
                '.minecraft'
            );

        fs.ensureDirSync(
            minecraftDir
        );

        // ========================================
        // ARCHIVOS DEL MRPACK
        // ========================================

        const filesList =
            Array.isArray(index.files)
                ? index.files
                : [];

        let completed = 0;

        sendProgress(
            'mods',
            0,
            filesList.length,
            `Descargando archivos: 0/${filesList.length}`
        );

        for (const entry of filesList) {
            if (
                entry.env?.client ===
                'unsupported'
            ) {
                completed++;
                continue;
            }

            const relative =
                String(
                    entry.path || ''
                ).replace(
                    /\\/g,
                    '/'
                );

            if (
                !relative ||
                relative.startsWith('/') ||
                relative.includes('../') ||
                /^[A-Za-z]:\//.test(
                    relative
                )
            ) {
                throw new Error(
                    `Ruta inválida en modrinth.index.json: ${relative}`
                );
            }

            const destination =
                path.join(
                    minecraftDir,
                    relative
                );

            if (
                !ensureInsideDirectory(
                    minecraftDir,
                    destination
                )
            ) {
                throw new Error(
                    `Ruta fuera de la instancia: ${relative}`
                );
            }

            fs.ensureDirSync(
                path.dirname(
                    destination
                )
            );

            // ====================================
            // VERIFICAR HASH
            // ====================================

            let valid = false;

            if (
                fs.existsSync(destination) &&
                entry.hashes?.sha1
            ) {
                try {
                    const currentHash =
                        sha1File(
                            destination
                        );

                    valid =
                        currentHash.toLowerCase() ===
                        String(
                            entry.hashes.sha1
                        ).toLowerCase();
                } catch (_) {
                    valid = false;
                }
            } else if (
                fs.existsSync(destination)
            ) {
                valid = true;
            }

            // ====================================
            // DESCARGAR
            // ====================================

            if (!valid) {
                const downloads =
                    Array.isArray(
                        entry.downloads
                    )
                        ? entry.downloads
                        : [];

                let ok = false;

                for (
                    const url
                    of downloads
                ) {
                    try {
                        ok =
                            await downloadFile(
                                url,
                                destination,
                                3
                            );

                        if (
                            ok &&
                            entry.hashes?.sha1
                        ) {
                            const hash =
                                sha1File(
                                    destination
                                );

                            if (
                                hash.toLowerCase() !==
                                String(
                                    entry.hashes.sha1
                                ).toLowerCase()
                            ) {
                                fs.removeSync(
                                    destination
                                );

                                ok = false;
                            }
                        }

                        if (ok) {
                            break;
                        }
                    } catch (error) {
                        logger.warn(
                            `⚠️ Falló descarga ${relative}: ` +
                            error.message
                        );
                    }
                }

                if (!ok) {
                    throw new Error(
                        `No se pudo descargar ${relative}`
                    );
                }
            }

            completed++;

            if (
                completed % 5 === 0 ||
                completed === filesList.length
            ) {
                sendProgress(
                    'mods',
                    completed,
                    filesList.length,
                    `Archivos: ${completed}/${filesList.length}`
                );
            }
        }

        // ========================================
        // OVERRIDES
        // ========================================

        const overrides =
            path.join(
                instanceDir,
                'overrides'
            );

        if (
            fs.existsSync(overrides)
        ) {
            fs.copySync(
                overrides,
                minecraftDir,
                {
                    overwrite: true
                }
            );

            fs.removeSync(
                overrides
            );
        }

        // ========================================
        // METADATOS
        // ========================================

        const instanceMeta = {
            name:
                nombreLimpio,

            type:
                'modrinth',

            projectId,

            versionId,

            minecraftVersion:
                gameVersion,

            gameVersions: [
                gameVersion
            ],

            loader,

            loaderVersion,

            installedAt:
                new Date().toISOString(),

            authType:
                'offline'
        };

        const repairManifest = {
            format: 1,

            generatedAt:
                new Date().toISOString(),

            minecraftVersion:
                gameVersion,

            loader,

            loaderVersion,

            files:
                filesList.map(
                    entry => ({
                        path:
                            entry.path,

                        hashes:
                            entry.hashes || {},

                        downloads:
                            entry.downloads || [],

                        env:
                            entry.env || {}
                    })
                )
        };

        fs.writeJsonSync(
            path.join(
                instanceDir,
                'repair-manifest.json'
            ),
            repairManifest,
            {
                spaces: 2
            }
        );

        fs.writeJsonSync(
            path.join(
                instanceDir,
                'version.json'
            ),
            instanceMeta,
            {
                spaces: 2
            }
        );

        fs.writeJsonSync(
            path.join(
                instanceDir,
                'instance.json'
            ),
            instanceMeta,
            {
                spaces: 2
            }
        );

        // ========================================
        // MINECRAFT
        // ========================================

        await downloadMinecraftVanilla(
            gameVersion,
            minecraftDir
        );

        await downloadAssets(
            gameVersion,
            minecraftDir
        );

        await downloadLibraries(
            gameVersion,
            minecraftDir
        );

        let loaderInfo = null;

        if (loader === 'fabric') {
            loaderInfo =
                await installFabric(
                    gameVersion,
                    minecraftDir,
                    loaderVersion
                );
        }

        if (loader === 'forge') {
            loaderInfo =
                await installForge(
                    gameVersion,
                    minecraftDir,
                    loaderVersion
                );
        }

        if (loader === 'neoforge') {
            loaderInfo =
                await installNeoForge(
                    gameVersion,
                    minecraftDir,
                    loaderVersion
                );
        }

        if (
            loaderInfo?.version &&
            loaderInfo.version !==
            loaderVersion
        ) {
            instanceMeta.loaderVersion =
                loaderInfo.version;

            fs.writeJsonSync(
                path.join(
                    instanceDir,
                    'version.json'
                ),
                instanceMeta,
                {
                    spaces: 2
                }
            );

            fs.writeJsonSync(
                path.join(
                    instanceDir,
                    'instance.json'
                ),
                instanceMeta,
                {
                    spaces: 2
                }
            );
        }

        // ========================================
        // LIMPIEZA
        // ========================================

        try {
            fs.removeSync(
                zipPath
            );
        } catch (_) {}

        try {
            const finalIndex =
                path.join(
                    instanceDir,
                    'modrinth.index.json'
                );

            if (
                fs.existsSync(finalIndex)
            ) {
                fs.removeSync(
                    finalIndex
                );
            }
        } catch (_) {}

        sendProgress(
            'modpack',
            1,
            1,
            'Modpack instalado'
        );

        return {
            success: true,
            path: instanceDir,
            loader,
            loaderVersion:
                loaderInfo?.version ||
                loaderVersion
        };
    } catch (error) {
        logger.error(
            `❌ Error instalando Modrinth: ` +
            `${error.stack || error.message}`
        );

        try {
            if (
                fs.existsSync(zipPath)
            ) {
                fs.removeSync(
                    zipPath
                );
            }

            if (
                fs.existsSync(instanceDir)
            ) {
                fs.removeSync(
                    instanceDir
                );
            }
        } catch (_) {}

        return {
            success: false,
            error:
                `Error instalando modpack: ${error.message}`
        };
    }
}


// ============================================
// MODPACKS INTELIGENTES
// ============================================

async function checkModpackUpdate(instancePath) {
    const safeInstancePath = assertInstancePath(instancePath);
    const metadataPath = path.join(safeInstancePath, 'version.json');
    if (!fs.existsSync(metadataPath)) return { success: true, isModpack: false, updateAvailable: false };
    let metadata;
    try { metadata = fs.readJsonSync(metadataPath); } catch (_) { return { success: true, isModpack: false, updateAvailable: false }; }
    if (!metadata.projectId || metadata.type !== 'modrinth') return { success: true, isModpack: false, updateAvailable: false };
    const info = await modrinth.getModrinthModpack(metadata.projectId);
    const currentVersionId = metadata.versionId;
    const current = info.versions.find(v => v.id === currentVersionId);
    const compatible = info.versions.filter(v => {
        const gameOk = !metadata.minecraftVersion || (v.game_versions || []).includes(metadata.minecraftVersion);
        const loaderOk = !metadata.loader || metadata.loader === 'vanilla' || (v.loaders || []).map(modrinth.normalizeLoader).includes(modrinth.normalizeLoader(metadata.loader));
        return gameOk && loaderOk && v.version_type === 'release';
    }).sort((a,b) => new Date(b.date_published || 0) - new Date(a.date_published || 0));
    const latest = compatible[0] || info.latestVersion;
    return {
        success: true,
        isModpack: true,
        projectId: metadata.projectId,
        currentVersionId,
        currentVersion: current?.version_number || current?.name || currentVersionId || 'Desconocida',
        latestVersionId: latest?.id || null,
        latestVersion: latest?.version_number || latest?.name || null,
        updateAvailable: !!latest && latest.id !== currentVersionId,
        title: info.title,
        minecraftVersion: metadata.minecraftVersion,
        loader: metadata.loader
    };
}

// ============================================
// GESTOR DE MODS MODRINTH
// ============================================

async function searchModrinthMods(query, limit = 30, filters = {}) {
    return modrinthMods.searchMods(query, limit, filters);
}

async function getModrinthMod(projectId) {
    return modrinthMods.getMod(projectId);
}

async function listInstanceMods(instancePath) {
    const safeInstancePath = assertInstancePath(instancePath);
    const modsDir = path.join(safeInstancePath, '.minecraft', 'mods');
    if (!fs.existsSync(modsDir)) return [];
    const metadataPath = path.join(safeInstancePath, '.minesteam-mods.json');
    let metadata = {};
    try { if (fs.existsSync(metadataPath)) metadata = fs.readJsonSync(metadataPath); } catch (_) {}
    return fs.readdirSync(modsDir)
        .filter(file => /\.jar(?:\.disabled)?$/i.test(file))
        .map(file => {
            const disabled = /\.disabled$/i.test(file);
            const activeFile = disabled ? file.replace(/\.disabled$/i, '') : file;
            const fullPath = path.join(modsDir, file);
            const stat = fs.statSync(fullPath);
            const meta = metadata[activeFile] || {};
            return { file, activeFile, path: fullPath, size: stat.size, modifiedAt: stat.mtime.toISOString(), disabled, ...meta };
        });
}

async function toggleInstanceMod(instancePath, fileName, enabled) {
    if (!fileName || /[\\/]/.test(fileName) || !/\.jar(?:\.disabled)?$/i.test(fileName)) throw new Error('Nombre de mod inválido');
    const safeInstancePath = assertInstancePath(instancePath);
    const modsDir = path.join(safeInstancePath, '.minecraft', 'mods');
    const targetName = enabled ? fileName.replace(/\.disabled$/i, '') : (fileName.endsWith('.disabled') ? fileName : `${fileName}.disabled`);
    const from = path.resolve(modsDir, fileName);
    const to = path.resolve(modsDir, targetName);
    const root = path.resolve(modsDir);
    if (!(from.startsWith(root + path.sep) && to.startsWith(root + path.sep))) throw new Error('Ruta de mod inválida');
    if (!fs.existsSync(from)) return { success:false, error:'El mod no existe' };
    if (fs.existsSync(to)) fs.removeSync(to);
    fs.moveSync(from, to);
    return { success:true, file:targetName, enabled };
}

async function checkInstanceModUpdates(instancePath) {
    const safeInstancePath = assertInstancePath(instancePath);
    const mods = await listInstanceMods(safeInstancePath);
    const updates = [];
    for (const mod of mods) {
        if (!mod.projectId || !mod.versionId || mod.disabled) continue;
        try {
            const info = await modrinthMods.getMod(mod.projectId);
            const compatible = info.versions
                .filter(v => v.id !== mod.versionId && Array.isArray(v.files) && v.files.length)
                .filter(v => !mod.gameVersion || v.game_versions?.includes(mod.gameVersion))
                .filter(v => !mod.loader || mod.loader === 'vanilla' || v.loaders?.map(modrinthMods.normalizeLoader).includes(modrinthMods.normalizeLoader(mod.loader)))
                .sort((a,b) => new Date(b.date_published||0)-new Date(a.date_published||0))[0];
            if (compatible && compatible.id !== mod.versionId) {
                updates.push({ ...mod, latestVersionId: compatible.id, latestVersion: compatible.version_number || compatible.id, updateAvailable:true });
            }
        } catch (_) {}
    }
    return updates;
}

async function updateInstanceMods(instancePath) {
    const safeInstancePath = assertInstancePath(instancePath);
    const updates = await checkInstanceModUpdates(safeInstancePath);
    const results = [];
    const modsDir = path.join(safeInstancePath, '.minecraft', 'mods');
    const backupDir = path.join(safeInstancePath, '.minesteam-backups', 'mods', new Date().toISOString().replace(/[:.]/g, '-'));
    fs.ensureDirSync(backupDir);
    let backupsCreated = 0;

    for (const update of updates) {
        const oldFile = update.activeFile || update.file;
        try {
            const oldPath = oldFile ? path.join(modsDir, oldFile) : null;
            let backupPath = null;
            if (oldPath && fs.existsSync(oldPath)) {
                backupPath = path.join(backupDir, oldFile);
                fs.copyFileSync(oldPath, backupPath);
                backupsCreated += 1;
            }
            const result = await installModrinthMod({ instancePath: safeInstancePath, projectId: update.projectId, versionId: update.latestVersionId, gameVersion: update.gameVersion, loader: update.loader });
            if (oldFile && result.file !== oldFile) { if (oldPath && fs.existsSync(oldPath)) fs.removeSync(oldPath); }
            results.push({ success:true, projectId:update.projectId, oldFile, newFile:result.file, versionId:result.versionId, backupPath });
        } catch (error) {
            results.push({ success:false, projectId:update.projectId, file:oldFile, error:error.message });
        }
    }
    if (!results.length) { try { fs.removeSync(backupDir); } catch (_) {} }
    return { success:results.every(r=>r.success), checked:updates.length, updated:results.filter(r=>r.success).length, failed:results.filter(r=>!r.success).length, backupsCreated, backupDir: backupsCreated ? backupDir : null, results };
}

async function installModrinthMod(data) {
    const { instancePath, projectId, versionId, gameVersion, loader } = data || {};
    if (!instancePath) throw new Error('No se indicó la instancia donde instalar el mod');
    if (!projectId) throw new Error('No se indicó el proyecto de Modrinth');

    const safeInstancePath = assertInstancePath(instancePath);
    const instanceMinecraftDir = path.join(safeInstancePath, '.minecraft');
    fs.ensureDirSync(instanceMinecraftDir);
    const modsDir = path.join(instanceMinecraftDir, 'mods');
    fs.ensureDirSync(modsDir);

    const metaPath = path.join(safeInstancePath, 'version.json');
    let instanceMeta = {};
    if (fs.existsSync(metaPath)) {
        try { instanceMeta = fs.readJsonSync(metaPath); } catch (_) {}
    }

    const targetGameVersion = gameVersion || instanceMeta.minecraftVersion || instanceMeta.gameVersions?.[0];
    const targetLoader = loader || instanceMeta.loader || 'vanilla';
    const modVersion = await modrinthMods.resolveCompatibleVersion(projectId, versionId, targetGameVersion, targetLoader);
    if (!modVersion) {
        throw new Error(`No se encontró una versión compatible del mod para ${targetGameVersion || 'la instancia'} / ${targetLoader}`);
    }

    const file = modVersion.files?.find(item => item.primary) || modVersion.files?.[0];
    if (!file?.url) throw new Error('El mod no tiene un archivo descargable');

    const fileName = path.basename(file.filename || new URL(file.url).pathname);
    if (!/^.+\.jar$/i.test(fileName)) throw new Error('El archivo seleccionado no es un mod .jar válido');

    const destination = path.join(modsDir, fileName);
    const tempPath = `${destination}.download`;

    try {
        sendProgress('mod', 0, 1, `Descargando ${fileName}...`);
        const ok = await downloadFile(file.url, tempPath, 5);
        if (!ok) throw new Error(`No se pudo descargar ${fileName}`);

        if (file.hashes?.sha1) {
            const hash = sha1File(tempPath);
            if (hash.toLowerCase() !== String(file.hashes.sha1).toLowerCase()) {
                throw new Error(`Hash SHA-1 inválido para ${fileName}`);
            }
        }

        fs.moveSync(tempPath, destination, { overwrite: true });
        const metadataPath = path.join(safeInstancePath, '.minesteam-mods.json');
        let metadata = {};
        try { if (fs.existsSync(metadataPath)) metadata = fs.readJsonSync(metadataPath); } catch (_) {}
        metadata[fileName] = { projectId, versionId: modVersion.id, gameVersion: targetGameVersion, loader: targetLoader, installedAt: new Date().toISOString() };
        fs.writeJsonSync(metadataPath, metadata, { spaces: 2 });
        sendProgress('mod', 1, 1, `${fileName} instalado`);
        return { success: true, projectId, versionId: modVersion.id, file: fileName, path: destination, gameVersion: targetGameVersion, loader: targetLoader };
    } finally {
        if (fs.existsSync(tempPath)) { try { fs.removeSync(tempPath); } catch (_) {} }
    }
}

async function removeInstanceMod(instancePath, fileName) {
    if (!fileName || /[\\/]/.test(fileName) || !/\.jar(?:\.disabled)?$/i.test(fileName)) throw new Error('Nombre de mod inválido');
    const safeInstancePath = assertInstancePath(instancePath);
    const modsDir = path.join(safeInstancePath, '.minecraft', 'mods');
    const target = path.resolve(modsDir, fileName);
    const root = path.resolve(modsDir);
    if (!(target === root || target.startsWith(root + path.sep))) throw new Error('Ruta de mod inválida');
    if (!fs.existsSync(target)) return { success: false, error: 'El mod no existe' };
    fs.removeSync(target);
    return { success: true, file: fileName };
}

function safeArchiveExtract(archive, destination) {
    fs.ensureDirSync(destination);
    for (const entry of archive.getEntries()) {
        const normalized = String(entry.entryName || '').replace(/\\/g, '/').replace(/^\/+/, '');
        const parts = normalized.split('/');
        if (parts.some(part => part === '..')) throw new Error(`Ruta insegura dentro del ZIP: ${entry.entryName}`);
        const target = path.resolve(destination, normalized);
        const root = path.resolve(destination);
        if (!(target === root || target.startsWith(root + path.sep))) throw new Error(`Ruta fuera del destino: ${entry.entryName}`);
        if (entry.isDirectory) fs.ensureDirSync(target);
        else { fs.ensureDirSync(path.dirname(target)); fs.writeFileSync(target, entry.getData()); }
    }
}

async function importModrinthMrpack(zipPath, instanceName) {
    const name = sanitizeName(instanceName || path.basename(zipPath, path.extname(zipPath)));
    const instanceDir = path.join(INSTANCES_DIR, name);
    const tempDir = path.join(CACHE_DIR, `import-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    if (fs.existsSync(instanceDir)) return { success: false, error: 'Ya existe una instancia con ese nombre' };

    try {
        const archive = new AdmZip(zipPath);
        const indexEntry = archive.getEntries().find(entry => {
            const n = String(entry.entryName || '').replace(/\\/g, '/').replace(/^\.\//, '');
            return n === 'modrinth.index.json' || n.endsWith('/modrinth.index.json');
        });
        if (!indexEntry) throw new Error('El ZIP no contiene modrinth.index.json');
        safeArchiveExtract(archive, tempDir);
        const indexPath = findFileRecursive(tempDir, 'modrinth.index.json');
        if (!indexPath) throw new Error('No se pudo leer modrinth.index.json');

        const index = fs.readJsonSync(indexPath);
        const dependencies = index.dependencies || {};
        const gameVersion = dependencies.minecraft;
        if (!gameVersion) throw new Error('El modpack no indica la versión de Minecraft');

        let loader = 'vanilla';
        let loaderVersion = null;
        if (dependencies['fabric-loader']) { loader = 'fabric'; loaderVersion = dependencies['fabric-loader']; }
        else if (dependencies.neoforge) { loader = 'neoforge'; loaderVersion = dependencies.neoforge; }
        else if (dependencies.forge) { loader = 'forge'; loaderVersion = dependencies.forge; }

        fs.ensureDirSync(instanceDir);
        const minecraftDir = path.join(instanceDir, '.minecraft');
        fs.ensureDirSync(minecraftDir);
        const filesList = Array.isArray(index.files) ? index.files : [];
        let completed = 0;

        for (const entry of filesList) {
            const env = entry.env || {};
            if (env.client === 'unsupported') continue;
            const relative = String(entry.path || '').replace(/\\/g, '/');
            if (!relative || relative.split('/').some(part => part === '..')) throw new Error(`Ruta inválida en modrinth.index.json: ${relative}`);
            const destination = path.resolve(instanceDir, relative);
            const root = path.resolve(instanceDir);
            if (!(destination === root || destination.startsWith(root + path.sep))) throw new Error(`Ruta fuera de la instancia: ${relative}`);

            let valid = false;
            if (entry.hashes?.sha1 && fs.existsSync(destination)) {
                try { valid = sha1File(destination).toLowerCase() === String(entry.hashes.sha1).toLowerCase(); } catch (_) { valid = false; }
            } else if (fs.existsSync(destination)) valid = true;

            if (!valid) {
                const downloads = Array.isArray(entry.downloads) ? entry.downloads : [];
                let downloaded = false;
                for (const url of downloads) {
                    try {
                        downloaded = await downloadFile(url, destination, 3);
                        if (downloaded && entry.hashes?.sha1) {
                            const hash = sha1File(destination);
                            if (hash.toLowerCase() !== String(entry.hashes.sha1).toLowerCase()) { fs.removeSync(destination); downloaded = false; }
                        }
                        if (downloaded) break;
                    } catch (_) {}
                }
                if (!downloaded) throw new Error(`No se pudo descargar ${relative}`);
            }
            completed++;
            sendProgress('mods', completed, Math.max(filesList.length, 1), `Archivos: ${completed}/${filesList.length}`);
        }

        const overrides = findFileRecursive(tempDir, 'overrides');
        if (overrides && fs.statSync(overrides).isDirectory()) fs.copySync(overrides, minecraftDir, { overwrite: true });

        await downloadMinecraftVanilla(gameVersion, minecraftDir);
        await downloadAssets(gameVersion, minecraftDir);
        await downloadLibraries(gameVersion, minecraftDir);
        let loaderInfo = null;
        if (loader === 'fabric') loaderInfo = await installFabric(gameVersion, minecraftDir, loaderVersion);
        if (loader === 'forge') loaderInfo = await installForge(gameVersion, minecraftDir, loaderVersion);
        if (loader === 'neoforge') loaderInfo = await installNeoForge(gameVersion, minecraftDir, loaderVersion);

        const metadata = { name, type: 'modrinth', source: 'local-import', minecraftVersion: gameVersion, gameVersions: [gameVersion], loader, loaderVersion: loaderInfo?.version || loaderVersion, installedAt: new Date().toISOString(), authType: 'offline' };
        fs.writeJsonSync(path.join(instanceDir, 'version.json'), metadata, { spaces: 2 });
        fs.writeJsonSync(path.join(instanceDir, 'instance.json'), metadata, { spaces: 2 });
        return { success: true, path: instanceDir, loader, loaderVersion: metadata.loaderVersion };
    } catch (error) {
        try { if (fs.existsSync(instanceDir)) fs.removeSync(instanceDir); } catch (_) {}
        return { success: false, error: `Error importando MRPACK: ${error.message}` };
    } finally {
        if (fs.existsSync(tempDir)) { try { fs.removeSync(tempDir); } catch (_) {} }
    }
}

async function importZipFile(zipPath, instanceName) {
    if (!zipPath || !fs.existsSync(zipPath)) return { success: false, error: 'El archivo ZIP no existe' };
    const archive = new AdmZip(zipPath);
    const entries = archive.getEntries().map(entry => String(entry.entryName || '').replace(/\\/g, '/').replace(/^\.\//, ''));
    const hasModrinth = entries.some(name => name === 'modrinth.index.json' || name.endsWith('/modrinth.index.json'));
    const hasCurseForge = entries.some(name => name === 'manifest.json' || name.endsWith('/manifest.json'));
    if (hasModrinth) return importModrinthMrpack(zipPath, instanceName);
    if (hasCurseForge) return importCurseForgeZip(zipPath, instanceName);

    const name = sanitizeName(instanceName || path.basename(zipPath, path.extname(zipPath)));
    const instanceDir = path.join(INSTANCES_DIR, name);
    if (fs.existsSync(instanceDir)) return { success: false, error: 'Ya existe una instancia con ese nombre' };
    const tempDir = path.join(CACHE_DIR, `generic-import-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    try {
        fs.ensureDirSync(instanceDir);
        safeArchiveExtract(archive, tempDir);
        const minecraftSource = fs.existsSync(path.join(tempDir, '.minecraft')) ? path.join(tempDir, '.minecraft') : tempDir;
        const minecraftDir = path.join(instanceDir, '.minecraft');
        fs.copySync(minecraftSource, minecraftDir, { overwrite: true });
        const metadata = { name, type: 'zip-import', source: 'local-import', installedAt: new Date().toISOString(), authType: 'offline' };
        fs.writeJsonSync(path.join(instanceDir, 'version.json'), metadata, { spaces: 2 });
        fs.writeJsonSync(path.join(instanceDir, 'instance.json'), metadata, { spaces: 2 });
        return { success: true, path: instanceDir, loader: 'unknown' };
    } catch (error) {
        try { if (fs.existsSync(instanceDir)) fs.removeSync(instanceDir); } catch (_) {}
        return { success: false, error: `Error importando ZIP: ${error.message}` };
    } finally {
        if (fs.existsSync(tempDir)) { try { fs.removeSync(tempDir); } catch (_) {} }
    }
}

// ============================================
// CURSEFORGE
// ============================================

async function importCurseForgeZip(
    zipPath,
    instanceName
) {
    const nombreLimpio =
        sanitizeName(instanceName);

    const instanceDir =
        path.join(
            INSTANCES_DIR,
            nombreLimpio
        );

    if (fs.existsSync(instanceDir)) {
        return {
            success: false,
            error:
                'Ya existe una instancia con ese nombre'
        };
    }

    if (
        !zipPath ||
        !fs.existsSync(zipPath)
    ) {
        return {
            success: false,
            error:
                'El archivo CurseForge no existe'
        };
    }

    try {
        fs.ensureDirSync(
            instanceDir
        );

        await extract(
            zipPath,
            {
                dir: instanceDir
            }
        );

        // ========================================
        // BUSCAR MANIFEST
        // ========================================

        const manifestPath =
            findFileRecursive(
                instanceDir,
                'manifest.json'
            );

        // ========================================
        // ZIP SIMPLE SIN MANIFEST
        // ========================================

        if (!manifestPath) {
            const minecraftDir =
                path.join(
                    instanceDir,
                    '.minecraft'
                );

            fs.ensureDirSync(
                minecraftDir
            );

            const modsSource =
                findFileRecursive(
                    instanceDir,
                    'mods'
                );

            if (
                modsSource &&
                fs.statSync(
                    modsSource
                ).isDirectory()
            ) {
                const modsDest =
                    path.join(
                        minecraftDir,
                        'mods'
                    );

                fs.copySync(
                    modsSource,
                    modsDest,
                    {
                        overwrite: true
                    }
                );
            }

            const versionJson = {
                name:
                    nombreLimpio,

                minecraftVersion:
                    '1.20.4',

                gameVersions: [
                    '1.20.4'
                ],

                loader:
                    'vanilla',

                type:
                    'curseforge',

                installedAt:
                    new Date().toISOString()
            };

            fs.writeJsonSync(
                path.join(
                    instanceDir,
                    'version.json'
                ),
                versionJson,
                {
                    spaces: 2
                }
            );

            await downloadMinecraftVanilla(
                '1.20.4',
                minecraftDir
            );

            await downloadAssets(
                '1.20.4',
                minecraftDir
            );

            await downloadLibraries(
                '1.20.4',
                minecraftDir
            );

            return {
                success: true,
                path: instanceDir
            };
        }

        // ========================================
        // MANIFEST CURSEFORGE
        // ========================================

        const manifest =
            fs.readJsonSync(
                manifestPath
            );

        const gameVersion =
            manifest.minecraft?.version ||
            '1.20.4';

        const minecraftDir =
            path.join(
                instanceDir,
                '.minecraft'
            );

        fs.ensureDirSync(
            minecraftDir
        );

        // ========================================
        // LOCALIZAR ROOT DEL MANIFEST
        // ========================================

        const manifestRoot =
            path.dirname(
                manifestPath
            );

        const modsSource =
            path.join(
                manifestRoot,
                'mods'
            );

        const modsDest =
            path.join(
                minecraftDir,
                'mods'
            );

        if (
            fs.existsSync(modsSource)
        ) {
            fs.copySync(
                modsSource,
                modsDest,
                {
                    overwrite: true
                }
            );
        }

        // ========================================
        // OVERRIDES
        // ========================================

        const overrides =
            path.join(
                manifestRoot,
                'overrides'
            );

        if (
            fs.existsSync(overrides)
        ) {
            fs.copySync(
                overrides,
                minecraftDir,
                {
                    overwrite: true
                }
            );
        }

        // ========================================
        // LOADER
        // ========================================

        const modLoaderId =
            manifest.minecraft
                ?.modLoaders?.[0]
                ?.id || '';

        const lowerLoader =
            String(
                modLoaderId
            ).toLowerCase();

        let loader =
            'vanilla';

        if (
            lowerLoader.includes(
                'neoforge'
            )
        ) {
            loader = 'neoforge';
        } else if (
            lowerLoader.includes(
                'forge'
            )
        ) {
            loader = 'forge';
        } else if (
            lowerLoader.includes(
                'fabric'
            )
        ) {
            loader = 'fabric';
        }

        loader = loaderManager.normalizeLoader(loader);

        let loaderVersion =
            null;

        if (
            modLoaderId.includes('-')
        ) {
            const parts =
                modLoaderId.split('-');

            loaderVersion =
                parts.slice(1).join('-');
        }

        const versionJson = {
            name:
                nombreLimpio,

            minecraftVersion:
                gameVersion,

            gameVersions: [
                gameVersion
            ],

            loader,

            loaderVersion,

            type:
                'curseforge',

            installedAt:
                new Date().toISOString()
        };

        fs.writeJsonSync(
            path.join(
                instanceDir,
                'version.json'
            ),
            versionJson,
            {
                spaces: 2
            }
        );

        // ========================================
        // MINECRAFT BASE
        // ========================================

        await downloadMinecraftVanilla(
            gameVersion,
            minecraftDir
        );

        await downloadAssets(
            gameVersion,
            minecraftDir
        );

        await downloadLibraries(
            gameVersion,
            minecraftDir
        );

        // ========================================
        // LOADER
        // ========================================

        if (loader === 'forge') {
            const installed =
                await installForge(
                    gameVersion,
                    minecraftDir,
                    loaderVersion
                );

            if (
                installed?.version
            ) {
                versionJson.loaderVersion =
                    installed.version;

                fs.writeJsonSync(
                    path.join(
                        instanceDir,
                        'version.json'
                    ),
                    versionJson,
                    {
                        spaces: 2
                    }
                );
            }
        }

        if (loader === 'fabric') {
            const installed =
                await installFabric(
                    gameVersion,
                    minecraftDir,
                    loaderVersion
                );

            if (
                installed?.version
            ) {
                versionJson.loaderVersion =
                    installed.version;

                fs.writeJsonSync(
                    path.join(
                        instanceDir,
                        'version.json'
                    ),
                    versionJson,
                    {
                        spaces: 2
                    }
                );
            }
        }

        if (loader === 'neoforge') {
            const installed =
                await installNeoForge(
                    gameVersion,
                    minecraftDir,
                    loaderVersion
                );

            if (
                installed?.version
            ) {
                versionJson.loaderVersion =
                    installed.version;

                fs.writeJsonSync(
                    path.join(
                        instanceDir,
                        'version.json'
                    ),
                    versionJson,
                    {
                        spaces: 2
                    }
                );
            }
        }

        return {
            success: true,
            path: instanceDir,
            loader,
            loaderVersion:
                versionJson.loaderVersion
        };
    } catch (error) {
        logger.error(
            `❌ Error importando CurseForge: ` +
            `${error.stack || error.message}`
        );

        try {
            if (
                fs.existsSync(
                    instanceDir
                )
            ) {
                fs.removeSync(
                    instanceDir
                );
            }
        } catch (_) {}

        return {
            success: false,
            error:
                `Error importando CurseForge: ${error.message}`
        };
    }
}

// ============================================
// INSTANCIAS
// ============================================

async function getInstances() {
    if (
        !fs.existsSync(
            INSTANCES_DIR
        )
    ) {
        return [];
    }

    const dirs =
        fs.readdirSync(
            INSTANCES_DIR
        );

    const instances = [];

    for (const dir of dirs) {
        const instancePath =
            path.join(
                INSTANCES_DIR,
                dir
            );

        const versionPath =
            path.join(
                instancePath,
                'version.json'
            );

        if (
            !fs.existsSync(
                versionPath
            )
        ) {
            continue;
        }

        try {
            const data =
                fs.readJsonSync(
                    versionPath
                );

            instances.push({
                name:
                    data.name ||
                    dir,

                path:
                    instancePath,

                type:
                    data.type ||
                    'custom',

                loader:
                    data.loader ||
                    'vanilla',

                loaderVersion:
                    data.loaderVersion ||
                    null,

                version:
                    data.gameVersions?.[0] ||
                    data.minecraftVersion ||
                    '1.20.4',

                installedAt:
                    data.installedAt ||
                    new Date().toISOString()
            });
        } catch (error) {
            logger.warn(
                `⚠️ No se pudo leer ${dir}: ` +
                error.message
            );
        }
    }

    return instances;
}

async function deleteInstance(
    instancePath
) {
    if (
        !instancePath ||
        !fs.existsSync(instancePath)
    ) {
        return {
            success: false,
            error:
                'La instancia no existe'
        };
    }

    await fs.remove(
        instancePath
    );

    return {
        success: true
    };
}

// ============================================
// REPARACIÓN
// ============================================

async function repairInstance(
    instancePath
) {
    const safeInstancePath = assertInstancePath(instancePath);

    const metaPath =
        path.join(
            safeInstancePath,
            'version.json'
        );

    if (!fs.existsSync(metaPath)) {
        throw new Error(
            'Falta version.json'
        );
    }

    const meta =
        fs.readJsonSync(
            metaPath
        );

    const minecraftVersion =
        meta.minecraftVersion ||
        meta.gameVersions?.[0];

    if (!minecraftVersion) {
        throw new Error(
            'No se pudo determinar la versión de Minecraft'
        );
    }

    const minecraftDir =
        path.join(
            safeInstancePath,
            '.minecraft'
        );

    fs.ensureDirSync(
        minecraftDir
    );

    sendProgress(
        'repair',
        0,
        4,
        'Reparando Minecraft...'
    );

    await downloadMinecraftVanilla(
        minecraftVersion,
        minecraftDir
    );

    sendProgress(
        'repair',
        1,
        4,
        'Reparando assets...'
    );

    await downloadAssets(
        minecraftVersion,
        minecraftDir
    );

    sendProgress(
        'repair',
        2,
        4,
        'Reparando librerías...'
    );

    await downloadLibraries(
        minecraftVersion,
        minecraftDir
    );

    // ========================================
    // REPARAR ARCHIVOS DEL MODPACK
    // ========================================

    const manifestPath =
        path.join(
            safeInstancePath,
            'repair-manifest.json'
        );

    if (
        fs.existsSync(
            manifestPath
        )
    ) {
        const manifest =
            fs.readJsonSync(
                manifestPath
            );

        const files =
            Array.isArray(
                manifest.files
            )
                ? manifest.files
                : [];

        let done = 0;

        for (
            const entry
            of files
        ) {
            if (
                entry.env?.client ===
                'unsupported'
            ) {
                done++;
                continue;
            }

            const relative =
                String(
                    entry.path || ''
                ).replace(
                    /\\/g,
                    '/'
                );

            if (
                !relative ||
                relative.startsWith('/') ||
                relative.includes('../') ||
                /^[A-Za-z]:\//.test(
                    relative
                )
            ) {
                done++;
                continue;
            }

            const destination =
                path.join(
                    minecraftDir,
                    relative
                );

            if (
                !ensureInsideDirectory(
                    minecraftDir,
                    destination
                )
            ) {
                done++;
                continue;
            }

            let valid = false;

            if (
                fs.existsSync(destination) &&
                entry.hashes?.sha1
            ) {
                try {
                    const hash =
                        sha1File(
                            destination
                        );

                    valid =
                        hash.toLowerCase() ===
                        String(
                            entry.hashes.sha1
                        ).toLowerCase();
                } catch (_) {
                    valid = false;
                }
            } else if (
                fs.existsSync(destination)
            ) {
                valid = true;
            }

            if (
                !valid &&
                Array.isArray(
                    entry.downloads
                )
            ) {
                fs.ensureDirSync(
                    path.dirname(
                        destination
                    )
                );

                for (
                    const url
                    of entry.downloads
                ) {
                    try {
                        const ok =
                            await downloadFile(
                                url,
                                destination,
                                3
                            );

                        if (!ok) {
                            continue;
                        }

                        if (
                            entry.hashes?.sha1
                        ) {
                            const hash =
                                sha1File(
                                    destination
                                );

                            if (
                                hash.toLowerCase() !==
                                String(
                                    entry.hashes.sha1
                                ).toLowerCase()
                            ) {
                                fs.removeSync(
                                    destination
                                );

                                continue;
                            }
                        }

                        valid = true;
                        break;
                    } catch (_) {}
                }
            }

            if (
                !valid &&
                entry.downloads?.length
            ) {
                throw new Error(
                    `No se pudo reparar ${relative}`
                );
            }

            done++;

            if (
                done % 10 === 0 ||
                done === files.length
            ) {
                sendProgress(
                    'repair',
                    done,
                    Math.max(
                        files.length,
                        1
                    ),
                    `Comprobando mods: ${done}/${files.length}`
                );
            }
        }
    }

    // ========================================
    // LOADER
    // ========================================

    const loader = loaderManager.normalizeLoader(
        meta.loader || 'vanilla'
    );

    if (loader === 'fabric') {
        await installFabric(
            minecraftVersion,
            minecraftDir,
            meta.loaderVersion ||
            null
        );
    }

    if (loader === 'forge') {
        await installForge(
            minecraftVersion,
            minecraftDir,
            meta.loaderVersion ||
            null
        );
    }

    if (loader === 'neoforge') {
        await installNeoForge(
            minecraftVersion,
            minecraftDir,
            meta.loaderVersion ||
            null
        );
    }

    sendProgress(
        'repair',
        4,
        4,
        'Reparación completada'
    );

    return {
        success: true,
        path: instancePath,
        message:
            'Instancia reparada correctamente'
    };
}

// ============================================
// DUPLICAR INSTANCIA
// ============================================

async function duplicateInstance(
    instancePath,
    newName
) {
    if (
        !instancePath ||
        !fs.existsSync(instancePath)
    ) {
        throw new Error(
            'La instancia original no existe'
        );
    }

    const name =
        sanitizeName(newName);

    const destination =
        path.join(
            INSTANCES_DIR,
            name
        );

    if (
        fs.existsSync(destination)
    ) {
        throw new Error(
            'Ya existe una instancia con ese nombre'
        );
    }

    await fs.copy(
        instancePath,
        destination
    );

    const metaPath =
        path.join(
            destination,
            'version.json'
        );

    if (
        fs.existsSync(metaPath)
    ) {
        const meta =
            fs.readJsonSync(
                metaPath
            );

        meta.name = name;

        meta.installedAt =
            new Date().toISOString();

        fs.writeJsonSync(
            metaPath,
            meta,
            {
                spaces: 2
            }
        );

        const instanceMeta =
            path.join(
                destination,
                'instance.json'
            );

        if (
            fs.existsSync(
                instanceMeta
            )
        ) {
            fs.writeJsonSync(
                instanceMeta,
                meta,
                {
                    spaces: 2
                }
            );
        }
    }

    return {
        success: true,
        path: destination,
        name
    };
}

// ============================================
// DIAGNÓSTICOS
// ============================================

async function getInstanceDiagnostics(
    instancePath
) {
    if (
        !instancePath ||
        !fs.existsSync(instancePath)
    ) {
        throw new Error(
            'La instancia no existe'
        );
    }

    const metaPath =
        path.join(
            instancePath,
            'version.json'
        );

    const meta =
        fs.existsSync(metaPath)
            ? fs.readJsonSync(
                metaPath
            )
            : {};

    const minecraftVersion =
        meta.minecraftVersion ||
        meta.gameVersions?.[0] ||
        null;

    const javaRequired =
        minecraftVersion
            ? await getRequiredJavaVersion(
                minecraftVersion
            )
            : null;

    const javaDetected =
        detectJavaVersion();

    const minecraftJar =
        minecraftVersion
            ? path.join(
                instancePath,
                '.minecraft',
                'versions',
                minecraftVersion,
                `${minecraftVersion}.jar`
            )
            : null;

    const manifestPath =
        path.join(
            instancePath,
            'repair-manifest.json'
        );

    const missing = [];

    if (
        fs.existsSync(
            manifestPath
        )
    ) {
        const manifest =
            fs.readJsonSync(
                manifestPath
            );

        for (
            const file
            of manifest.files || []
        ) {
            const relative =
                String(
                    file.path || ''
                );

            const destination =
                path.join(
                    instancePath,
                    '.minecraft',
                    relative
                );

            if (
                !fs.existsSync(
                    destination
                )
            ) {
                missing.push(
                    relative
                );

                continue;
            }

            if (
                file.hashes?.sha1
            ) {
                try {
                    const hash =
                        sha1File(
                            destination
                        );

                    if (
                        hash.toLowerCase() !==
                        String(
                            file.hashes.sha1
                        ).toLowerCase()
                    ) {
                        missing.push(
                            `${relative} (hash)`
                        );
                    }
                } catch (_) {
                    missing.push(
                        `${relative} (error)`
                    );
                }
            }
        }
    }

    const minecraftPresent =
        Boolean(
            minecraftJar &&
            fs.existsSync(
                minecraftJar
            )
        );

    const javaCompatible =
        !javaRequired ||
        javaDetected ===
        Number(javaRequired);

    const languagePackPath = path.join(instancePath, '.minecraft', 'resourcepacks', 'MineSteam-Languages', 'pack.mcmeta');
    let languagesAvailable = false;
    try {
        languagesAvailable = fs.existsSync(languagePackPath) && fs.existsSync(path.join(instancePath, '.minecraft', 'resourcepacks', 'MineSteam-Languages', 'assets', 'minecraft', 'lang', 'en_us.json'));
    } catch (_) {}

    return {
        success: true,

        minecraftVersion,

        loader:
            meta.loader ||
            'vanilla',

        loaderVersion:
            meta.loaderVersion ||
            null,

        javaRequired,

        javaDetected,

        minecraftPresent,

        languagesAvailable,

        missingFiles:
            missing.slice(
                0,
                100
            ),

        healthy:
            missing.length === 0 &&
            minecraftPresent &&
            javaCompatible
    };
}

// ============================================
// CACHÉ
// ============================================

async function clearCache() {
    await fs.remove(
        CACHE_DIR
    );

    fs.ensureDirSync(
        CACHE_DIR
    );

    fs.ensureDirSync(
        ASSETS_CACHE
    );

    fs.ensureDirSync(
        LIBRARIES_CACHE
    );

    fs.ensureDirSync(
        JAVA_CACHE
    );

    return {
        success: true
    };
}

async function calculateDirectorySize(
    directory
) {
    if (
        !fs.existsSync(directory)
    ) {
        return 0;
    }

    let size = 0;

    const items =
        await fs.readdir(
            directory
        );

    for (
        const item
        of items
    ) {
        const fullPath =
            path.join(
                directory,
                item
            );

        const stat =
            await fs.stat(
                fullPath
            );

        if (stat.isDirectory()) {
            size +=
                await calculateDirectorySize(
                    fullPath
                );
        } else {
            size +=
                stat.size;
        }
    }

    return size;
}

async function getCacheSize() {
    if (!fs.existsSync(CACHE_DIR)) return 0;
    try {
        return await calculateDirectorySize(CACHE_DIR);
    } catch (error) {
        logger.warn(`No se pudo calcular el tamaño de caché: ${error.message}`);
        return 0;
    }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    launchMinecraft,

    findWorkingMirror,

    getVersionManifest,

    getLatestMinecraftVersion,

    getVersionList,

    getReleaseVersionList,
    getLoaderVersionList,

    downloadMinecraftVanilla,

    downloadAssets,

    downloadLibraries,

    installFabric,

    installForge,
    installNeoForge,

    crearInstanciaPersonalizada,

    getInstances,

    deleteInstance,

    repairInstance,

    duplicateInstance,

    getInstanceDiagnostics,

    searchModrinth,

    getModrinthModpack,

    installModpack,
    checkModpackUpdate,

    importCurseForgeZip,

    importZipFile,

    searchModrinthMods,

    getModrinthMod,

    installModrinthMod,

    listInstanceMods,

    toggleInstanceMod,

    checkInstanceModUpdates,

    updateInstanceMods,

    removeInstanceMod,

    clearCache,

    getCacheSize,

    downloadJava,

    getRequiredJavaVersion
};