const axios = require('axios');
const fs = require('fs-extra');
const https = require('https');
const http = require('http');

const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 16 });

/**
 * Descarga un archivo con barra de progreso
 */
async function downloadFile(url, outputPath, progressCallback) {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 120000,
      maxRedirects: 5,
      httpsAgent,
      httpAgent,
      headers: { 'User-Agent': 'MineSteam/2.4.0', 'Accept-Encoding': 'gzip, deflate' }
    });
    
    const totalLength = parseInt(response.headers['content-length'] || '0', 10);
    const writer = fs.createWriteStream(outputPath);
    
    let downloaded = 0;
    
    response.data.on('data', (chunk) => {
      downloaded += chunk.length;
      if (totalLength > 0 && progressCallback) {
        const progress = (downloaded / totalLength) * 100;
        progressCallback(progress);
      }
    });
    
    response.data.pipe(writer);
    
    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
    });
    
  } catch (error) {
    console.error('Error descargando archivo:', error);
    throw error;
  }
}

module.exports = {
  downloadFile
};