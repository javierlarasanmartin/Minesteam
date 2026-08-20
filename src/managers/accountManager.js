const crypto = require('crypto');
const store = require('../utils/secureStore');

function getActiveProfileId() {
  return String(store.get('activeProfileId', 'default'));
}

function getAccounts() {
  const accounts = store.get('accounts', []);
  return Array.isArray(accounts) ? accounts : [];
}

function saveAccounts(accounts) { store.set('accounts', accounts); return accounts; }

function normalizeAccount(account) {
  if (!account || typeof account !== 'object') return account;
  if (!account.profileId) account.profileId = 'default';
  return account;
}

function getAccountsForProfile(profileId = getActiveProfileId()) {
  const id = String(profileId || 'default');
  return getAccounts().map(normalizeAccount).filter(a => a.profileId === id);
}

function createOfflineAccount(name, profileId = getActiveProfileId()) {
  const username = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) throw new Error('El nombre debe tener entre 3 y 16 caracteres y solo usar letras, números o _.');
  const pid = String(profileId || getActiveProfileId());
  const accounts = getAccounts().map(normalizeAccount);
  const existing = accounts.find(a => a.profileId === pid && a.name.toLowerCase() === username.toLowerCase());
  if (existing) {
    existing.lastUsedAt = Date.now();
    saveAccounts(accounts);
    store.set(`activeAccountId:${pid}`, existing.id);
    return existing;
  }
  const digest = crypto.createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest();
  digest[6] = (digest[6] & 0x0f) | 0x30;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  const uuid = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  const account = { id: crypto.randomUUID(), name: username, uuid, accessToken: '0', authType: 'offline', offline: true, profileId: pid, createdAt: Date.now(), lastUsedAt: Date.now() };
  saveAccounts([...accounts, account]);
  store.set(`activeAccountId:${pid}`, account.id);
  store.set('activeAccountId', account.id);
  store.set('user', account);
  return account;
}

function selectAccount(id, profileId = getActiveProfileId()) {
  const pid = String(profileId || getActiveProfileId());
  const accounts = getAccounts().map(normalizeAccount);
  const account = accounts.find(a => a.id === id && a.profileId === pid);
  if (!account) throw new Error('Cuenta no encontrada en el perfil activo');
  account.lastUsedAt = Date.now();
  saveAccounts(accounts);
  store.set(`activeAccountId:${pid}`, id);
  store.set('activeAccountId', id);
  store.set('user', account);
  return account;
}

function getActiveAccount(profileId = getActiveProfileId()) {
  const pid = String(profileId || getActiveProfileId());
  const accounts = getAccountsForProfile(pid);
  const id = store.get(`activeAccountId:${pid}`, null);
  return accounts.find(a => a.id === id) || accounts[0] || null;
}

function deleteAccount(id, profileId = getActiveProfileId()) {
  const pid = String(profileId || getActiveProfileId());
  const accounts = getAccounts().map(normalizeAccount);
  if (!accounts.some(a => a.id === id && a.profileId === pid)) throw new Error('Cuenta no encontrada');
  const next = accounts.filter(a => a.id !== id);
  saveAccounts(next);
  if (store.get(`activeAccountId:${pid}`, null) === id) {
    const replacement = next.find(a => a.profileId === pid) || null;
    if (replacement) {
      store.set(`activeAccountId:${pid}`, replacement.id);
      store.set('activeAccountId', replacement.id);
      store.set('user', replacement);
    } else {
      store.delete(`activeAccountId:${pid}`);
      if (store.get('activeAccountId', null) === id) store.delete('activeAccountId');
      store.delete('user');
    }
  }
  return { success: true };
}

function logout(profileId = getActiveProfileId()) {
  const pid = String(profileId || getActiveProfileId());
  store.delete(`activeAccountId:${pid}`);
  if (store.get('activeAccountId', null) === null || store.get('activeAccountId', null) === undefined) store.delete('user');
  return { success: true };
}

module.exports = { getAccounts, getAccountsForProfile, createOfflineAccount, selectAccount, getActiveAccount, deleteAccount, logout };
