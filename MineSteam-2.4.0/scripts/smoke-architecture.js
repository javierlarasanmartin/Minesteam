const managers = require('../src/managers');

const expected = ['launch','loaders','mods','modpacks','imports','instances','java','diagnostics','content'];
for (const key of expected) {
  if (!managers[key]) throw new Error(`Falta manager: ${key}`);
}

const supported = managers.loaders.supported();
if (!supported.includes('fabric') || !supported.includes('forge') || !supported.includes('neoforge')) {
  throw new Error('Faltan loaders');
}

console.log('MineSteam architecture smoke test: OK');
