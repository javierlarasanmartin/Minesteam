const fs = require('fs-extra');
const path = require('path');
const { assertInstancePath } = require('./security');
const launcher = require('./launcherService');

async function getDirectorySize(directory) {
  if (!fs.existsSync(directory)) return 0;
  let total = 0;
  for (const item of await fs.readdir(directory)) {
    const fullPath = path.join(directory, item);
    const stat = await fs.stat(fullPath);
    total += stat.isDirectory() ? await getDirectorySize(fullPath) : stat.size;
  }
  return total;
}

async function getDetails(instancePath) {
  const safePath = assertInstancePath(instancePath);
  const minecraftDir = path.join(safePath, '.minecraft');
  if (!fs.existsSync(minecraftDir)) throw new Error('Falta .minecraft en la instancia');

  let javaVersion = 'Desconocida';
  const versionJsonPath = path.join(safePath, 'version.json');
  if (fs.existsSync(versionJsonPath)) {
    try {
      const data = fs.readJsonSync(versionJsonPath);
      const version = data.minecraftVersion || data.gameVersions?.[0];
      if (version) javaVersion = await launcher.getRequiredJavaVersion(version);
    } catch (_) {}
  }

  const stat = await fs.stat(minecraftDir);
  return {
    size: await getDirectorySize(minecraftDir),
    lastModified: stat.mtime,
    javaVersion
  };
}

module.exports = { getDirectorySize, getDetails };
