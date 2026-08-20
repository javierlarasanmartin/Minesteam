// src/managers/diagnosticManager.js
const { analyzeInstance } = require('../diagnostics/crashAnalyzer');

async function analyzeCrash(instancePath) {
    return analyzeInstance(instancePath);
}

module.exports = { analyzeCrash };
