const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const logger = require('../utils/logger');

function ensureLauncherProfile(instanceMinecraftDir, minecraftVersion) {
  const profilePath = path.join(instanceMinecraftDir, 'launcher_profiles.json');
  if (fs.existsSync(profilePath)) return;

  fs.writeJsonSync(profilePath, {
    profiles: {
      minesteam: {
        name: 'MineSteam',
        type: 'custom',
        lastVersionId: String(minecraftVersion)
      }
    },
    settings: {},
    version: 3
  }, { spaces: 2 });
  logger.info(`Perfil temporal del launcher creado para NeoForge: ${profilePath}`);
}

const MAVEN_ROOT = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';

function getMinecraftPrefix(minecraftVersion) {
  const value = String(minecraftVersion || '').trim();
  const match = value.match(/^(?:1\.)?(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return `${match[1]}${match[2] !== undefined ? `.${match[2]}` : ''}`;
}

async function getAvailableVersions(minecraftVersion) {
  const prefix = getMinecraftPrefix(minecraftVersion);
  if (!prefix) return [];

  try {
    const response = await axios.get(`${MAVEN_ROOT}/maven-metadata.xml`, {
      timeout: 20000,
      headers: { 'User-Agent': 'MineSteam/2.4.0', 'Accept': 'application/xml,text/xml,*/*' }
    });
    const xml = String(response.data || '');
    const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
    return versions.filter(version => version === prefix || version.startsWith(`${prefix}.`));
  } catch (error) {
    logger.warn(`NeoForge Maven metadata no disponible: ${error.message}`);
    try {
      const index = await axios.get(`${MAVEN_ROOT}/`, {
        timeout: 20000,
        headers: { 'User-Agent': 'MineSteam/2.4.0', 'Accept': 'text/html,*/*' }
      });
      const versions = [...String(index.data || '').matchAll(/href=[\"']([^/\"']+\/)[\"']/gi)]
        .map(m => m[1].replace(/\/$/, ''))
        .filter(version => version === prefix || version.startsWith(`${prefix}.`));
      return [...new Set(versions)];
    } catch (indexError) {
      logger.warn(`NeoForge Maven index tampoco está disponible: ${indexError.message}`);
      return [];
    }
  }
}

function compareVersions(a, b) {
  const parse = value => String(value).replace(/-beta|-alpha|-rc/gi, '').split('.').map(x => Number.parseInt(x, 10) || 0);
  const aa = parse(a); const bb = parse(b);
  const length = Math.max(aa.length, bb.length);
  for (let i = 0; i < length; i++) {
    if ((aa[i] || 0) !== (bb[i] || 0)) return (aa[i] || 0) - (bb[i] || 0);
  }
  return String(a).localeCompare(String(b));
}

async function resolveVersion(minecraftVersion, preferredVersion) {
  if (preferredVersion) return String(preferredVersion);

  const versions = await getAvailableVersions(minecraftVersion);
  const stable = versions.filter(v => !/-(beta|alpha|rc)/i.test(v));
  const candidates = stable.length ? stable : versions;

  if (!candidates.length) {
    throw new Error(`No se encontró NeoForge compatible con Minecraft ${minecraftVersion}`);
  }

  return candidates.sort(compareVersions).at(-1);
}

function findInstalledProfile(instanceMinecraftDir, loaderVersion) {
  const versionsDir = path.join(instanceMinecraftDir, 'versions');
  if (!fs.existsSync(versionsDir)) return null;

  const candidates = [];
  for (const directory of fs.readdirSync(versionsDir)) {
    const lower = directory.toLowerCase();
    if (!lower.includes('neoforge')) continue;

    const jsonPath = path.join(versionsDir, directory, `${directory}.json`);
    if (!fs.existsSync(jsonPath)) continue;
    if (loaderVersion && !directory.includes(String(loaderVersion))) continue;

    try {
      const data = fs.readJsonSync(jsonPath);
      candidates.push({ path: jsonPath, data, mtime: fs.statSync(jsonPath).mtimeMs });
    } catch (_) {}
  }

  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0] || null;
}

async function install(minecraftVersion, instanceMinecraftDir, preferredVersion, services) {
  try {
    const neoForgeVersion = await resolveVersion(minecraftVersion, preferredVersion);
    const installerUrl = `${MAVEN_ROOT}/${encodeURIComponent(neoForgeVersion)}/neoforge-${neoForgeVersion}-installer.jar`;
    const installerPath = path.join(instanceMinecraftDir, 'neoforge-installer.jar');

    if (!fs.existsSync(installerPath)) {
      const ok = await services.downloadFile(installerUrl, installerPath, 5);
      if (!ok) throw new Error(`No se pudo descargar NeoForge ${neoForgeVersion}`);
    }

    ensureLauncherProfile(instanceMinecraftDir, minecraftVersion);

    const javaVersion = await services.getRequiredJavaVersion(minecraftVersion);
    const javaExecutable = await services.downloadJava(javaVersion);

    await new Promise((resolve, reject) => {
      const proc = spawn(javaExecutable, [
        '-jar', installerPath,
        '--installClient', instanceMinecraftDir
      ], {
        cwd: instanceMinecraftDir,
        stdio: 'inherit',
        shell: false
      });

      proc.on('error', reject);
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`El instalador de NeoForge terminó con código ${code}`));
      });
    });

    const installed = findInstalledProfile(instanceMinecraftDir, neoForgeVersion);
    if (!installed) {
      throw new Error(`NeoForge ${neoForgeVersion} se instaló pero no se encontró el perfil en versions/`);
    }

    if (!installed.data.mainClass) {
      throw new Error(`El perfil NeoForge ${neoForgeVersion} no contiene mainClass`);
    }

    const libraries = await services.downloadLoaderLibraries(installed.data, instanceMinecraftDir);

    logger.info(`NeoForge ${neoForgeVersion} preparado para Minecraft ${minecraftVersion}`);
    return {
      profile: installed.data,
      libraries,
      version: neoForgeVersion
    };
  } catch (error) {
    logger.error(`Error instalando NeoForge: ${error.message}`);
    throw new Error(`Error instalando NeoForge ${minecraftVersion}: ${error.message}`);
  }
}

module.exports = {
  install,
  resolveVersion,
  getAvailableVersions,
  getMinecraftPrefix,
  findInstalledProfile
};
