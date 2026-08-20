// src/utils/javaManager.js
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios');
const { spawn, execSync } = require('child_process');
const { app } = require('electron');
const AdmZip = require('adm-zip');
const logger = require('./logger');

const JAVA_RUNTIME_DIR = path.join(app.getPath('userData'), 'java-runtime');
const ADOPTIUM_API = 'https://api.adoptium.net/v3';
const MOJANG_MANIFEST = 'https://launchermeta.mojang.com/mc/game/version_manifest.json';

// Fallback cuando Mojang no está disponible.
const JAVA_VERSION_MAP = {
    '26': 25,
    '25': 25,
    '24': 21,
    '23': 21,
    '22': 21,
    '21': 21,
    '20': 21,
    '19': 17,
    '18': 17,
    '17': 16,
    '16': 8,
    '15': 8,
    '14': 8,
    '13': 8,
    '12': 8,
    '11': 8,
    '10': 8,
    '9': 8,
    '8': 8
};

function getPlatform() {
    if (process.platform === 'win32') return 'windows';
    if (process.platform === 'darwin') return 'mac';
    if (process.platform === 'linux') return 'linux';
    return process.platform;
}

function getArch() {
    if (process.arch === 'x64') return 'x64';
    if (process.arch === 'ia32') return 'x86';
    if (process.arch === 'arm64') return 'aarch64';
    return 'x64';
}

function getExtension() {
    return getPlatform() === 'windows' ? 'zip' : 'tar.gz';
}

function getFallbackJavaVersion(minecraftVersion) {
    const value = String(minecraftVersion || '').trim();
    const parts = value.split('.').map(Number);

    if (!parts.length || Number.isNaN(parts[0])) return 21;

    // Versiones modernas sin prefijo 1.x, por ejemplo 26.2.
    if (parts[0] >= 26) return 25;
    if (parts[0] > 1) return JAVA_VERSION_MAP[String(parts[0])] || 21;

    const minor = parts[1] || 0;
    const patch = parts[2] || 0;
    if (minor >= 21) return 21;
    if (minor === 20 && patch >= 5) return 21;
    if (minor >= 18) return 17;
    if (minor === 17) return 16;
    return 8;
}

// API síncrona de compatibilidad: sirve como fallback inmediato.
function getRequiredJavaVersion(minecraftVersion) {
    return getFallbackJavaVersion(minecraftVersion);
}

// Fuente de verdad: el JSON oficial de cada versión de Minecraft incluye
// javaVersion.majorVersion. Esto evita mantener manualmente una tabla eterna.
async function resolveRequiredJavaVersion(minecraftVersion) {
    const fallback = getFallbackJavaVersion(minecraftVersion);
    const version = String(minecraftVersion || '').trim();
    if (!version) return fallback;

    try {
        const manifest = await axios.get(MOJANG_MANIFEST, { timeout: 10000 });
        const entry = (manifest.data?.versions || []).find(v => v.id === version && v.url);
        if (!entry) return fallback;

        const metadata = await axios.get(entry.url, { timeout: 10000 });
        const major = Number(metadata.data?.javaVersion?.majorVersion);
        if (Number.isInteger(major) && major > 0) {
            logger.info(`Java requerido por Mojang para Minecraft ${version}: Java ${major}`);
            return major;
        }
    } catch (error) {
        logger.warn(`No se pudo consultar el Java requerido de Mojang para ${version}; usando fallback Java ${fallback}: ${error.message}`);
    }

    return fallback;
}

function detectSystemJavaVersion() {
    try {
        const output = execSync(process.platform === 'win32' ? 'java -version 2>&1' : 'java -version 2>&1', {
            encoding: 'utf8',
            windowsHide: true
        });
        const match = output.match(/version\s+"(\d+)(?:\.(\d+))?/i);
        if (!match) return 0;
        const major = Number(match[1]);
        return major === 1 ? Number(match[2] || 0) : major;
    } catch (_) {
        return 0;
    }
}

function findJavaExecutable(root) {
    const executable = getPlatform() === 'windows' ? 'java.exe' : 'java';
    if (!fs.existsSync(root)) return null;

    const direct = path.join(root, 'bin', executable);
    if (fs.existsSync(direct)) return direct;

    const queue = [root];
    let scanned = 0;
    while (queue.length && scanned < 1000) {
        const current = queue.shift();
        scanned++;
        let entries;
        try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_) { continue; }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (entry.name !== 'node_modules' && entry.name !== '__MACOSX') queue.push(full);
            } else if (entry.name.toLowerCase() === executable.toLowerCase() && path.basename(path.dirname(full)).toLowerCase() === 'bin') {
                return full;
            }
        }
    }
    return null;
}

function getLocalJavaPath(javaVersion) {
    const platform = getPlatform();
    const arch = getArch();
    const runtimeDir = path.join(JAVA_RUNTIME_DIR, `jdk-${javaVersion}-${platform}-${arch}`);
    return findJavaExecutable(runtimeDir);
}

async function verifyJavaExecutable(javaPath, expectedMajor) {
    try {
        const output = execSync(`"${javaPath}" -version 2>&1`, {
            encoding: 'utf8',
            windowsHide: true
        });
        const match = output.match(/version\s+"(\d+)(?:\.(\d+))?/i);
        if (!match) return false;
        const major = Number(match[1]) === 1 ? Number(match[2] || 0) : Number(match[1]);
        return major === Number(expectedMajor);
    } catch (_) {
        return false;
    }
}

async function downloadJava(javaVersion) {
    const platform = getPlatform();
    const arch = getArch();
    const ext = getExtension();
    const runtimeDir = path.join(JAVA_RUNTIME_DIR, `jdk-${javaVersion}-${platform}-${arch}`);

    const existing = getLocalJavaPath(javaVersion);
    if (existing && await verifyJavaExecutable(existing, javaVersion)) {
        logger.info(`Java ${javaVersion} ya está disponible en el runtime de MineSteam`);
        return existing;
    }

    await fs.ensureDir(runtimeDir);

    try {
        logger.info(`Buscando JDK ${javaVersion} para ${platform}/${arch} en Adoptium...`);
        const response = await axios.get(`${ADOPTIUM_API}/assets/latest/${javaVersion}/hotspot`, {
            params: {
                architecture: arch,
                image_type: 'jdk',
                jvm_impl: 'hotspot',
                os: platform,
                project: 'jdk',
                vendor: 'eclipse'
            },
            timeout: 20000
        });

        const release = (response.data || []).find(r => r.binary?.package?.link);
        if (!release) throw new Error(`No se encontró un JDK ${javaVersion} para ${platform}/${arch}`);

        const downloadUrl = release.binary.package.link;
        const fileName = release.binary.package.name || `jdk-${javaVersion}.${ext}`;
        const destPath = path.join(runtimeDir, fileName);

        logger.info(`Descargando JDK ${javaVersion}: ${fileName}`);
        const ok = await downloadFile(downloadUrl, destPath);
        if (!ok) throw new Error(`No se pudo descargar JDK ${javaVersion}`);

        logger.info(`Extrayendo JDK ${javaVersion}...`);
        if (ext === 'zip') {
            const zip = new AdmZip(destPath);
            zip.extractAllTo(runtimeDir, true);
        } else {
            await extractTarGz(destPath, runtimeDir);
        }
        await fs.remove(destPath);

        const javaPath = getLocalJavaPath(javaVersion);
        if (!javaPath || !(await verifyJavaExecutable(javaPath, javaVersion))) {
            throw new Error(`El JDK descargado no corresponde a Java ${javaVersion} o no contiene un ejecutable válido`);
        }

        logger.info(`JDK ${javaVersion} instalado automáticamente: ${javaPath}`);
        return javaPath;
    } catch (error) {
        logger.error(`Error descargando Java ${javaVersion}: ${error.message}`);
        throw error;
    }
}

function extractTarGz(tarPath, destDir) {
    return new Promise((resolve, reject) => {
        const tar = spawn('tar', ['-xzf', tarPath, '-C', destDir, '--strip-components=1'], { windowsHide: true });
        tar.on('close', code => code === 0 ? resolve() : reject(new Error(`tar falló con código ${code}`)));
        tar.on('error', reject);
    });
}

async function downloadFile(url, destPath, retries = 3) {
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) return true;
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios({
                method: 'GET', url, responseType: 'stream', timeout: 300000,
                headers: { 'User-Agent': 'MineSteam/2.4.0' }
            });
            const writer = fs.createWriteStream(destPath);
            response.data.pipe(writer);
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
                response.data.on('error', reject);
            });
            return true;
        } catch (error) {
            try { await fs.remove(destPath); } catch (_) {}
            logger.warn(`Intento ${i + 1}/${retries} fallido: ${error.message}`);
            if (i === retries - 1) return false;
            await new Promise(r => setTimeout(r, 2000 * (i + 1)));
        }
    }
    return false;
}

async function getJavaPath(minecraftVersion) {
    const requiredVersion = await resolveRequiredJavaVersion(minecraftVersion);
    const systemJava = detectSystemJavaVersion();

    // Importante: no usamos Java 25 para Minecraft 1.21 solo porque sea mayor.
    // Se exige la major version requerida para evitar incompatibilidades.
    if (systemJava === requiredVersion) {
        logger.info(`Java ${systemJava} del sistema coincide con Java ${requiredVersion} requerido`);
        return 'java';
    }

    const localJava = getLocalJavaPath(requiredVersion);
    if (localJava && await verifyJavaExecutable(localJava, requiredVersion)) {
        logger.info(`Java ${requiredVersion} encontrado en runtime local`);
        return localJava;
    }

    logger.info(`Java ${requiredVersion} no disponible. MineSteam lo descargará automáticamente.`);
    return downloadJava(requiredVersion);
}

module.exports = {
    getRequiredJavaVersion,
    resolveRequiredJavaVersion,
    getJavaPath,
    detectSystemJavaVersion,
    getLocalJavaPath,
    downloadJava
};
