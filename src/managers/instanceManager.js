/**
 * InstanceManager
 *
 * Fase 1: adaptador del sistema actual de instancias.
 */
const legacy = require('../launcher/minecraft-launcher');

async function list() { return legacy.getInstances(); }
async function create(data) { return legacy.crearInstanciaPersonalizada(data); }
async function remove(instancePath) { return legacy.deleteInstance(instancePath); }
async function repair(instancePath) { return legacy.repairInstance(instancePath); }
async function duplicate(instancePath, name) { return legacy.duplicateInstance(instancePath, name); }
async function diagnose(instancePath) { return legacy.getInstanceDiagnostics(instancePath); }

module.exports = { list, create, remove, repair, duplicate, diagnose };
