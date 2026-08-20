const pLimit = require('p-limit');
const fs = require('fs-extra');
const axios = require('axios');
const https = require('https');
const http = require('http');
const logger = require('./logger');

const limit = pLimit(24);
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 48, maxFreeSockets: 24 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 48, maxFreeSockets: 24 });
const active = new Map();

async function downloadFileParallel(url, destPath, retries = 3) {
  const key = require('path').resolve(destPath);
  if (active.has(key)) return active.get(key);

  const task = limit(async () => {
    if (fs.existsSync(destPath)) {
      try { if (fs.statSync(destPath).size > 0) return true; } catch (_) {}
    }
    await fs.ensureDir(require('path').dirname(destPath));
    const part = `${destPath}.part`;

    for (let i = 0; i < retries; i++) {
      try {
        if (fs.existsSync(part)) await fs.remove(part);
        const response = await axios({
          method: 'GET', url, responseType: 'stream', timeout: 180000,
          maxRedirects: 10, maxContentLength: Infinity, maxBodyLength: Infinity,
          httpsAgent, httpAgent,
          headers: { 'User-Agent': 'MineSteam/2.4.0', 'Accept': '*/*', 'Connection': 'keep-alive' }
        });
        const writer = fs.createWriteStream(part, { highWaterMark: 1024 * 1024 });
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve); writer.on('error', reject); response.data.on('error', reject); response.data.pipe(writer);
        });
        if ((await fs.stat(part)).size <= 0) throw new Error('archivo vacío');
        await fs.move(part, destPath, { overwrite: true });
        return true;
      } catch (error) {
        logger.warn(`Descarga ${i + 1}/${retries} fallida: ${error.message}`);
        if (i < retries - 1) await new Promise(r => setTimeout(r, Math.min(1000 * (i + 1), 3000)));
      }
    }
    return false;
  });

  active.set(key, task);
  try { return await task; } finally { active.delete(key); }
}

module.exports = { downloadFileParallel };
