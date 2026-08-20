const store = require('../utils/secureStore');
const crypto = require('crypto');
const net = require('net');

const DEFAULT_PROFILE = {
  id: 'default',
  name: 'Principal',
  description: 'Perfil principal de MineSteam',
  color: '#4f8cff',
  createdAt: Date.now(),
  updatedAt: Date.now()
};

function loadProfiles() {
  const profiles = store.get('profiles', [DEFAULT_PROFILE]);
  return Array.isArray(profiles) && profiles.length ? profiles : [DEFAULT_PROFILE];
}

function saveProfiles(profiles) {
  store.set('profiles', profiles);
  return profiles;
}

function getProfiles() {
  return loadProfiles();
}

function createProfile(data = {}) {
  const now = Date.now();
  const profile = {
    id: crypto.randomUUID(),
    name: String(data.name || 'Nuevo perfil').trim().slice(0, 40) || 'Nuevo perfil',
    description: String(data.description || '').trim().slice(0, 120),
    color: /^#[0-9a-f]{6}$/i.test(data.color || '') ? data.color : '#4f8cff',
    createdAt: now,
    updatedAt: now
  };
  saveProfiles([...loadProfiles(), profile]);
  return profile;
}

function updateProfile(id, patch = {}) {
  const profiles = loadProfiles();
  const profile = profiles.find(p => p.id === id);
  if (!profile) throw new Error('Perfil no encontrado');
  Object.assign(profile, {
    ...(patch.name !== undefined ? { name: String(patch.name).trim().slice(0, 40) || profile.name } : {}),
    ...(patch.description !== undefined ? { description: String(patch.description).trim().slice(0, 120) } : {}),
    ...(patch.color !== undefined && /^#[0-9a-f]{6}$/i.test(patch.color) ? { color: patch.color } : {}),
    updatedAt: Date.now()
  });
  saveProfiles(profiles);
  return profile;
}

function deleteProfile(id) {
  if (id === 'default') throw new Error('El perfil Principal no se puede eliminar');
  const profiles = loadProfiles();
  const next = profiles.filter(p => p.id !== id);
  if (next.length === profiles.length) throw new Error('Perfil no encontrado');
  saveProfiles(next);
  const all = getInstanceProfiles();
  let reassigned = 0;
  for (const [instancePath, cfg] of Object.entries(all)) {
    if (cfg && cfg.profileId === id) {
      all[instancePath] = { ...cfg, profileId: 'default', updatedAt: Date.now() };
      reassigned++;
    }
  }
  store.set('instanceProfiles', all);
  if (store.get('activeProfileId', 'default') === id) store.set('activeProfileId', 'default');
  return { success: true, reassignedInstances: reassigned };
}

function getProfileStats(profileId) {
  const id = String(profileId || getActiveProfile().id);
  const profiles = loadProfiles();
  const profile = profiles.find(p => p.id === id);
  if (!profile) throw new Error('Perfil no encontrado');
  const configs = getInstanceProfiles();
  const instances = Object.values(configs).filter(c => c && c.profileId === id);
  return {
    profileId: id,
    instanceCount: instances.length,
    favorites: instances.filter(c => c.favorite).length,
    totalRam: instances.reduce((sum, c) => sum + (Number(c.ram) || 0), 0),
    configuredServers: instances.filter(c => c.serverId).length,
    lastUpdated: Math.max(profile.updatedAt || 0, ...instances.map(c => c.updatedAt || 0))
  };
}

function getActiveProfile() {
  const id = store.get('activeProfileId', 'default');
  return loadProfiles().find(p => p.id === id) || loadProfiles()[0];
}

function setActiveProfile(id) {
  const profile = loadProfiles().find(p => p.id === id);
  if (!profile) throw new Error('Perfil no encontrado');
  store.set('activeProfileId', id);
  return profile;
}

function keyFor(instancePath) { return String(instancePath); }

function getInstanceProfiles() {
  return store.get('instanceProfiles', {});
}

function getInstanceConfig(instancePath) {
  const all = getInstanceProfiles();
  return all[keyFor(instancePath)] || {
    profileId: getActiveProfile().id,
    favorite: false,
    ram: 4096,
    javaVersion: null,
    jvmArgs: '',
    notes: '',
    serverId: null
  };
}

function setInstanceConfig(instancePath, patch = {}) {
  const all = getInstanceProfiles();
  const key = keyFor(instancePath);
  const current = getInstanceConfig(instancePath);
  const config = {
    ...current,
    ...(patch.profileId !== undefined ? { profileId: String(patch.profileId) } : {}),
    ...(patch.favorite !== undefined ? { favorite: !!patch.favorite } : {}),
    ...(patch.ram !== undefined ? { ram: Math.max(1024, Math.min(65536, Number(patch.ram) || 4096)) } : {}),
    ...(patch.javaVersion !== undefined ? { javaVersion: patch.javaVersion == null || patch.javaVersion === '' ? null : Number(patch.javaVersion) } : {}),
    ...(patch.jvmArgs !== undefined ? { jvmArgs: String(patch.jvmArgs || '').slice(0, 4000) } : {}),
    ...(patch.notes !== undefined ? { notes: String(patch.notes).slice(0, 1000) } : {}),
    ...(patch.serverId !== undefined ? { serverId: patch.serverId ? String(patch.serverId) : null } : {}),
    updatedAt: Date.now()
  };
  all[key] = config;
  store.set('instanceProfiles', all);
  return config;
}



function parseHostPort(address, port = 25565) {
  let host = String(address || '').trim();
  let targetPort = Number(port) || 25565;
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    if (end > 0) {
      const h = host.slice(1, end);
      const rest = host.slice(end + 1);
      if (rest.startsWith(':')) targetPort = Number(rest.slice(1)) || targetPort;
      return { host: h, port: targetPort };
    }
  }
  const colonCount = (host.match(/:/g) || []).length;
  if (colonCount === 1) {
    const parts = host.split(':');
    if (/^\d+$/.test(parts[1])) {
      host = parts[0];
      targetPort = Number(parts[1]) || targetPort;
    }
  }
  return { host, port: targetPort };
}

function writeVarInt(value) {
  const out = [];
  let n = Number(value) >>> 0;
  do {
    let temp = n & 0x7f;
    n >>>= 7;
    if (n !== 0) temp |= 0x80;
    out.push(temp);
  } while (n !== 0);
  return Buffer.from(out);
}

function readVarInt(buffer, offset = 0) {
  let num = 0;
  let shift = 0;
  for (let i = 0; i < 5 && offset + i < buffer.length; i++) {
    const b = buffer[offset + i];
    num |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value: num >>> 0, size: i + 1 };
    shift += 7;
  }
  return null;
}

function encodeString(value) {
  const body = Buffer.from(String(value), 'utf8');
  return Buffer.concat([writeVarInt(body.length), body]);
}

function pingServer(data = {}) {
  const { host, port } = parseHostPort(data.address, data.port);
  if (!host) throw new Error('La dirección del servidor es obligatoria');
  return new Promise(resolve => {
    const socket = new net.Socket();
    let buffer = Buffer.alloc(0);
    let finished = false;
    const started = Date.now();
    const finish = result => {
      if (finished) return;
      finished = true;
      try { socket.destroy(); } catch (_) {}
      resolve(result);
    };
    socket.setTimeout(5000);
    socket.on('timeout', () => finish({ online: false, latency: Date.now() - started, error: 'Tiempo de espera agotado' }));
    socket.on('error', err => finish({ online: false, latency: Date.now() - started, error: err.message }));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        const packetLen = readVarInt(buffer, 0);
        if (!packetLen) return;
        const header = packetLen.size;
        if (buffer.length < header + packetLen.value) return;
        const packet = buffer.subarray(header, header + packetLen.value);
        const packetId = readVarInt(packet, 0);
        if (!packetId || packetId.value !== 0) return finish({ online: false, latency: Date.now() - started, error: 'Respuesta inválida del servidor' });
        const strLen = readVarInt(packet, packetId.size);
        if (!strLen) return finish({ online: false, latency: Date.now() - started, error: 'Respuesta incompleta' });
        const jsonStart = packetId.size + strLen.size;
        const jsonEnd = jsonStart + strLen.value;
        const raw = packet.subarray(jsonStart, jsonEnd).toString('utf8');
        let status = {};
        try { status = JSON.parse(raw); } catch (_) {}
        const version = status.version?.name || '';
        const playersOnline = Number(status.players?.online || 0);
        const playersMax = Number(status.players?.max || 0);
        const description = typeof status.description === 'string' ? status.description : (status.description?.text || '');
        finish({ online: true, latency: Date.now() - started, version, playersOnline, playersMax, description });
      } catch (err) {
        finish({ online: false, latency: Date.now() - started, error: err.message });
      }
    });
    socket.connect(port, host, () => {
      const protocol = 767;
      const handshake = Buffer.concat([
        writeVarInt(0x00),
        writeVarInt(protocol),
        encodeString(host),
        Buffer.from([(port >> 8) & 0xff, port & 0xff]),
        writeVarInt(1)
      ]);
      const handshakePacket = Buffer.concat([writeVarInt(handshake.length), handshake]);
      const requestBody = writeVarInt(0x00);
      const requestPacket = Buffer.concat([writeVarInt(requestBody.length), requestBody]);
      socket.write(Buffer.concat([handshakePacket, requestPacket]));
    });
  });
}

function getServers() { return store.get('servers', []); }
function saveServers(servers) { store.set('servers', servers); return servers; }

function addServer(data = {}) {
  const server = {
    id: crypto.randomUUID(),
    name: String(data.name || 'Servidor').trim().slice(0, 50) || 'Servidor',
    address: String(data.address || '').trim().slice(0, 255),
    port: Number(data.port) || 25565,
    version: String(data.version || '').trim().slice(0, 30),
    favorite: data.favorite !== false,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  if (!server.address) throw new Error('La dirección del servidor es obligatoria');
  const servers = [...getServers(), server];
  saveServers(servers);
  return server;
}

function updateServer(id, patch = {}) {
  const servers = getServers();
  const server = servers.find(s => s.id === id);
  if (!server) throw new Error('Servidor no encontrado');
  if (patch.name !== undefined) server.name = String(patch.name).trim().slice(0, 50) || server.name;
  if (patch.address !== undefined) server.address = String(patch.address).trim().slice(0, 255);
  if (patch.port !== undefined) server.port = Number(patch.port) || 25565;
  if (patch.version !== undefined) server.version = String(patch.version).trim().slice(0, 30);
  if (patch.favorite !== undefined) server.favorite = !!patch.favorite;
  server.updatedAt = Date.now();
  saveServers(servers);
  return server;
}

function deleteServer(id) {
  saveServers(getServers().filter(s => s.id !== id));
  return { success: true };
}

module.exports = {
  getProfiles, createProfile, updateProfile, deleteProfile,
  getActiveProfile, setActiveProfile,
  getProfileStats,
  getInstanceConfig, setInstanceConfig,
  getServers, addServer, updateServer, deleteServer, pingServer
};
