const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const PACKAGE = require('../package.json');
const APP_NAME = PACKAGE.build.productName || 'Mi Launcher';
const VERSION = PACKAGE.version;

console.log(`
╔═══════════════════════════════════════════════╗
║   🎮 ${APP_NAME} - Compilador                 ║
║   📦 Versión ${VERSION}                       ║
╚═══════════════════════════════════════════════╝
`);

async function build() {
  console.log('\n🔧 Selecciona una opción:');
  console.log('  1. Windows (NSIS - Instalador)');
  console.log('  2. Windows (Portable)');
  console.log('  3. MacOS (DMG)');
  console.log('  4. Linux (AppImage)');
  console.log('  5. Todas las plataformas');
  console.log('  6. Salir\n');

  const answer = await askQuestion('Opción: ');

  switch(answer.trim()) {
    case '1':
      execSync('npm run build:win:nsis', { stdio: 'inherit' });
      break;
    case '2':
      execSync('npm run build:win:portable', { stdio: 'inherit' });
      break;
    case '3':
      execSync('npm run build:mac', { stdio: 'inherit' });
      break;
    case '4':
      execSync('npm run build:linux', { stdio: 'inherit' });
      break;
    case '5':
      execSync('npm run build', { stdio: 'inherit' });
      break;
    case '6':
      console.log('👋 ¡Hasta luego!');
      process.exit(0);
    default:
      console.log('❌ Opción inválida');
  }
}

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

build().then(() => rl.close());