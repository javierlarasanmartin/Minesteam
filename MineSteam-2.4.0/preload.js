const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') {
    throw new TypeError(`El callback de ${channel} debe ser una función`);
  }

  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);

  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('launcherAPI', {
  getInstances: () => ipcRenderer.invoke('get-instances'),
  getProfiles: () => ipcRenderer.invoke('profiles-list'),
  getActiveProfile: () => ipcRenderer.invoke('profile-active'),
  createProfile: data => ipcRenderer.invoke('profile-create', data),
  updateProfile: (id, data) => ipcRenderer.invoke('profile-update', id, data),
  deleteProfile: id => ipcRenderer.invoke('profile-delete', id),
  selectProfile: id => ipcRenderer.invoke('profile-select', id),
  getProfileStats: id => ipcRenderer.invoke('profile-stats', id),
  getInstanceConfig: path => ipcRenderer.invoke('instance-config-get', path),
  setInstanceConfig: (path, data) => ipcRenderer.invoke('instance-config-set', path, data),
  getServers: () => ipcRenderer.invoke('servers-list'),
  addServer: data => ipcRenderer.invoke('server-add', data),
  updateServer: (id, data) => ipcRenderer.invoke('server-update', id, data),
  deleteServer: id => ipcRenderer.invoke('server-delete', id),
  pingServer: data => ipcRenderer.invoke('server-ping', data),
  checkModpackUpdate: instancePath => ipcRenderer.invoke('modpack-check-update', instancePath),
  updateInstanceMods: instancePath => ipcRenderer.invoke('update-instance-mods', instancePath),
  listContent: (instancePath, type) => ipcRenderer.invoke('content-list', instancePath, type),
  deleteContent: (instancePath, type, name) => ipcRenderer.invoke('content-delete', instancePath, type, name),
  renameContent: (instancePath, type, oldName, newName) => ipcRenderer.invoke('content-rename', instancePath, type, oldName, newName),
  toggleContent: (instancePath, type, name, enabled) => ipcRenderer.invoke('content-toggle', instancePath, type, name, enabled),
  installContentFile: (instancePath, type, filePath) => ipcRenderer.invoke('content-install-file', instancePath, type, filePath),
  importWorld: (instancePath, filePath) => ipcRenderer.invoke('world-import', instancePath, filePath),
  openContentFolder: (instancePath, type) => ipcRenderer.invoke('content-open-folder', instancePath, type),
  searchContentModrinth: (type, query, limit = 20, offset = 0, gameVersion = null) => ipcRenderer.invoke('content-modrinth-search', type, query, limit, offset, gameVersion),
  installContentModrinth: (instancePath, type, projectId, versionId = null) => ipcRenderer.invoke('content-modrinth-install', instancePath, type, projectId, versionId),
  getContentModrinthVersions: (projectId, gameVersion = null) => ipcRenderer.invoke('content-modrinth-versions', projectId, gameVersion),
  listWorldBackups: instancePath => ipcRenderer.invoke('world-backups-list', instancePath),
  createWorldBackup: (instancePath, worldName) => ipcRenderer.invoke('world-backup-create', instancePath, worldName),
  restoreWorldBackup: (instancePath, backupPath) => ipcRenderer.invoke('world-backup-restore', instancePath, backupPath),
  exportInstance: instancePath => ipcRenderer.invoke('instance-export', instancePath),
  openExportsFolder: () => ipcRenderer.invoke('instance-exports-folder'),
  getInstanceDetails: instancePath => ipcRenderer.invoke('get-instance-details', instancePath),
  deleteInstance: instancePath => ipcRenderer.invoke('delete-instance', instancePath),
  repairInstance: instancePath => ipcRenderer.invoke('repair-instance', instancePath),
  repairInstanceAdvanced: instancePath => ipcRenderer.invoke('instance-repair-advanced', instancePath),
  createInstanceBackup: (instancePath, reason) => ipcRenderer.invoke('instance-backup-create', instancePath, reason),
  listInstanceBackups: instancePath => ipcRenderer.invoke('instance-backups-list', instancePath),
  restoreInstanceBackup: (instancePath, backupPath) => ipcRenderer.invoke('instance-backup-restore', instancePath, backupPath),
  listInstanceLogs: instancePath => ipcRenderer.invoke('instance-logs-list', instancePath),
  readInstanceLog: (instancePath, fileName) => ipcRenderer.invoke('instance-log-read', instancePath, fileName),
  openInstanceLogs: instancePath => ipcRenderer.invoke('instance-logs-open', instancePath),
  duplicateInstance: (instancePath, name) => ipcRenderer.invoke('duplicate-instance', instancePath, name),
  diagnoseInstance: instancePath => ipcRenderer.invoke('diagnose-instance', instancePath),
  crearInstanciaPersonalizada: data => ipcRenderer.invoke('crear-instancia', data),
  getLoaderVersionList: (loader, minecraftVersion) => ipcRenderer.invoke('get-loader-version-list', loader, minecraftVersion),
  openInstanceFolder: instancePath => ipcRenderer.invoke('open-instance-folder', instancePath),

  launchMinecraft: data => ipcRenderer.invoke('launch-minecraft', data),
  onLaunchState: callback => subscribe('launch-state', callback),

  searchModrinth: (query, limit, filters, offset = 0) => ipcRenderer.invoke('search-modrinth', query, limit, filters, offset),
  getModrinthModpack: id => ipcRenderer.invoke('get-modrinth-pack', id),
  installModpack: data => ipcRenderer.invoke('install-modpack', data),
  searchModrinthMods: (query, limit, filters) => ipcRenderer.invoke('search-modrinth-mods', query, limit, filters),
  getModrinthMod: projectId => ipcRenderer.invoke('get-modrinth-mod', projectId),
  installModrinthMod: data => ipcRenderer.invoke('install-modrinth-mod', data),
  listInstanceMods: instancePath => ipcRenderer.invoke('list-instance-mods', instancePath),
  toggleInstanceMod: (instancePath, fileName, enabled) => ipcRenderer.invoke('toggle-instance-mod', instancePath, fileName, enabled),
  checkModUpdates: instancePath => ipcRenderer.invoke('check-mod-updates', instancePath),
  updateInstanceMods: instancePath => ipcRenderer.invoke('update-instance-mods', instancePath),
  removeInstanceMod: (instancePath, fileName) => ipcRenderer.invoke('remove-instance-mod', instancePath, fileName),
  importCurseForgeZip: (zipPath, instanceName) => ipcRenderer.invoke('import-curseforge-zip', zipPath, instanceName),
  importZip: (zipPath, instanceName) => ipcRenderer.invoke('import-zip', zipPath, instanceName),

  getLatestMinecraftVersion: () => ipcRenderer.invoke('get-latest-version'),
  getVersionList: () => ipcRenderer.invoke('get-version-list'),
  getReleaseVersionList: () => ipcRenderer.invoke('get-release-version-list'),

  loginOffline: username => ipcRenderer.invoke('login-offline', username),
  logoutOffline: () => ipcRenderer.invoke('logout-offline'),
  getCurrentUser: () => ipcRenderer.invoke('get-current-user'),
  getAccounts: () => ipcRenderer.invoke('accounts-list'),
  selectAccount: id => ipcRenderer.invoke('account-select', id),
  deleteAccount: id => ipcRenderer.invoke('account-delete', id),

  clearCache: () => ipcRenderer.invoke('clear-cache'),
  getCacheSize: () => ipcRenderer.invoke('get-cache-size'),
  getJavaStatus: () => ipcRenderer.invoke('java-status'),
  installJava: version => ipcRenderer.invoke('java-install', version),
  analyzeCrash: instancePath => ipcRenderer.invoke('analyze-crash', instancePath),
  optimizerRecommendations: instancePath => ipcRenderer.invoke('optimizer-recommendations', instancePath),
  optimizerStatus: instancePath => ipcRenderer.invoke('optimizer-status', instancePath),
  optimizerApply: (instancePath, settings) => ipcRenderer.invoke('optimizer-apply', instancePath, settings),
  checkAppUpdate: () => ipcRenderer.invoke('check-app-update'),
  downloadAppUpdate: () => ipcRenderer.invoke('download-app-update'),

  onInstallProgress: callback => subscribe('install-progress', callback),
  onDownloadProgress: callback => subscribe('download-progress', callback),
  onTerminalLog: callback => subscribe('terminal-log', callback),
  onUpdateStatus: callback => subscribe('update-status', callback),
  onUpdateAvailable: callback => subscribe('update-available', callback),
  onUpdateNotAvailable: callback => subscribe('update-not-available', callback),
  onUpdateDownloaded: callback => subscribe('update-downloaded', callback),
  onUpdateDownloadProgress: callback => subscribe('update-download-progress', callback)
});
