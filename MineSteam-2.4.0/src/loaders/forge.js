const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const logger = require('../utils/logger');

function ensureForgeLauncherProfile(instanceMinecraftDir, minecraftVersion) {
  // Forge's installer expects a Minecraft Launcher profile file to exist.
  // MineSteam instances are isolated and normally do not have one because
  // the official launcher was never run for this directory.
  const profilePath = path.join(instanceMinecraftDir, 'launcher_profiles.json');
  if (fs.existsSync(profilePath)) return;

  const profiles = {
    profiles: {
      minesteam: {
        name: 'MineSteam',
        type: 'custom',
        lastVersionId: String(minecraftVersion)
      }
    },
    settings: {},
    version: 3
  };

  fs.writeJsonSync(profilePath, profiles, { spaces: 2 });
  logger.info(`Perfil temporal del launcher creado para Forge: ${profilePath}`);
}

async function getAvailableVersions(minecraftVersion) {
  const metadataUrl = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml';
  try {
    const response = await axios.get(metadataUrl, { timeout: 20000, headers: { 'User-Agent': 'MineSteam/2.4.0', 'Accept': 'application/xml,text/xml,*/*' } });
    const xml = String(response.data || '');
    const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
    const prefix = `${minecraftVersion}-`;
    const result = all.filter(v => v.startsWith(prefix)).map(v => ({ version: v.slice(prefix.length), coordinate: v }));
    if (result.length) return result;
  } catch (error) {
    logger.warn(`Forge Maven metadata no disponible: ${error.message}`);
  }

  // Fallback: Forge publica al menos las versiones recomendada/latest.
  try {
    const promotions = await axios.get('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', {
      timeout: 20000,
      headers: { 'User-Agent': 'MineSteam/2.4.0', 'Accept': 'application/json' }
    });
    const promos = promotions.data?.promos || {};
    const result = [];
    for (const key of [`${minecraftVersion}-recommended`, `${minecraftVersion}-latest`]) {
      const version = promos[key];
      if (version && !result.some(x => x.version === version)) result.push({ version, coordinate: `${minecraftVersion}-${version}` });
    }
    return result;
  } catch (error) {
    logger.warn(`Forge promotions tampoco está disponible: ${error.message}`);
    // Último respaldo: consultar el índice Maven directamente.
    try {
      const index = await axios.get('https://maven.minecraftforge.net/net/minecraftforge/forge/', {
        timeout: 20000,
        headers: { 'User-Agent': 'MineSteam/2.4.0', 'Accept': 'text/html,*/*' }
      });
      const prefix = `${minecraftVersion}-`;
      const matches = [...String(index.data || '').matchAll(new RegExp(`href=[\"'](${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^/\"']+)/`, 'gi'))]
        .map(m => m[1]);
      return [...new Set(matches)].map(coordinate => ({ version: coordinate.slice(prefix.length), coordinate }));
    } catch (indexError) {
      logger.warn(`Forge Maven index tampoco está disponible: ${indexError.message}`);
      return [];
    }
  }
}

async function install(minecraftVersion, instanceMinecraftDir, preferredVersion, services) {
  try {
    let forgeVersion = preferredVersion || null;

    if (!forgeVersion) {
      const promotions = await axios.get(
        'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json',
        { timeout: 20000 }
      );
      forgeVersion =
        promotions.data?.promos?.[`${minecraftVersion}-recommended`] ||
        promotions.data?.promos?.[`${minecraftVersion}-latest`];
    }

    if (!forgeVersion) {
      throw new Error(`No se encontró una versión Forge compatible con ${minecraftVersion}`);
    }

    const coordinate = `${minecraftVersion}-${forgeVersion}`;
    const installerUrl =
      `https://maven.minecraftforge.net/net/minecraftforge/forge/${coordinate}/forge-${coordinate}-installer.jar`;
    const installerPath = path.join(instanceMinecraftDir, 'forge-installer.jar');

    if (!fs.existsSync(installerPath)) {
      const ok = await services.downloadFile(installerUrl, installerPath, 5);
      if (!ok) throw new Error(`No se pudo descargar Forge ${coordinate}`);
    }

    ensureForgeLauncherProfile(instanceMinecraftDir, minecraftVersion);

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
        else reject(new Error(`El instalador de Forge terminó con código ${code}`));
      });
    });

    const profile = findInstalledProfile(instanceMinecraftDir, 'forge', forgeVersion);
    if (!profile) {
      throw new Error(`Forge se instaló pero no se encontró el perfil ${coordinate}`);
    }

    if (!profile.data.mainClass) {
      throw new Error(`El perfil Forge ${coordinate} no contiene mainClass`);
    }

    const libraries = await services.downloadLoaderLibraries(profile.data, instanceMinecraftDir);
    logger.info(`Forge ${coordinate} preparado`);

    return {
      profile: profile.data,
      libraries,
      version: forgeVersion
    };
  } catch (error) {
    logger.error(`Error instalando Forge: ${error.message}`);
    throw new Error(`Error instalando Forge ${minecraftVersion}: ${error.message}`);
  }
}

function findInstalledProfile(instanceMinecraftDir, loaderName, loaderVersion) {
  const versionsDir = path.join(instanceMinecraftDir, 'versions');
  if (!fs.existsSync(versionsDir)) return null;

  const candidates = [];
  for (const directory of fs.readdirSync(versionsDir)) {
    const lower = directory.toLowerCase();
    if (!lower.includes(loaderName) || lower.includes('neoforge')) continue;

    const jsonPath = path.join(versionsDir, directory, `${directory}.json`);
    if (!fs.existsSync(jsonPath)) continue;
    if (loaderVersion && !directory.includes(String(loaderVersion))) continue;

    try {
      candidates.push({
        path: jsonPath,
        data: fs.readJsonSync(jsonPath),
        mtime: fs.statSync(jsonPath).mtimeMs
      });
    } catch (_) {}
  }

  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0] || null;
}

module.exports = { install, findInstalledProfile, getAvailableVersions };
