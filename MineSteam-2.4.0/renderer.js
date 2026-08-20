// ============================================
// ESTADO GLOBAL
// ============================================
let currentView = 'instances';
let currentTheme = 'dark';
let searchResults = [];
let selectedLoader = 'vanilla';

// ============================================
// INICIALIZACIÓN
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 Renderer inicializado');
  loadTheme();
  checkSession();
  loadInstances();
  loadProfiles();
  loadServers();
  setupEventListeners();
  setupThemeToggle();
  setupRamSlider();
  setupLoaderButtons();
  loadLatestVersion();
  updateExploreMode();
});

// ============================================
// VERSIÓN MÁS RECIENTE
// ============================================
async function loadLatestVersion() {
  try {
    const latest = await window.launcherAPI.getLatestMinecraftVersion();
    const select = document.getElementById('instancia-version');
    if (select) {
      // Agregar opción "Última versión" al principio
      const option = document.createElement('option');
      option.value = 'latest';
      option.textContent = `🚀 Última versión (${latest})`;
      option.selected = true;
      select.prepend(option);
      // Guardar la versión real
      select.dataset.latest = latest;
      await loadLoaderVersions();
    }
  } catch (error) {
    console.error('Error cargando última versión:', error);
  }
}

async function loadLoaderVersions() {
  const loader = selectedLoader || 'vanilla';
  const minecraftSelect = document.getElementById('instancia-version');
  const loaderSelect = document.getElementById('instancia-loader-version');
  const group = document.getElementById('loader-version-group');
  if (!loaderSelect || !group) return;

  if (loader === 'vanilla') {
    group.style.display = 'none';
    loaderSelect.innerHTML = '<option value="">No aplica</option>';
    loaderSelect.value = '';
    return;
  }

  group.style.display = 'block';
  let minecraftVersion = minecraftSelect?.value || '';
  if (minecraftVersion === 'latest') minecraftVersion = minecraftSelect?.dataset?.latest || '';
  if (!minecraftVersion) {
    loaderSelect.innerHTML = '<option value="">Selecciona una versión de Minecraft</option>';
    return;
  }

  loaderSelect.disabled = true;
  loaderSelect.innerHTML = '<option value="">🔄 Cargando versiones...</option>';
  try {
    const result = await window.launcherAPI.getLoaderVersionList(loader, minecraftVersion);
    const versions = Array.isArray(result) ? result : [];
    if (!versions.length) {
      loaderSelect.innerHTML = '<option value="">No hay versiones compatibles</option>';
      return;
    }

    const normalized = versions.map(item => {
      if (typeof item === 'string') return { version: item, stable: true };
      return { version: item.version || item.coordinate, stable: item.stable !== false };
    }).filter(item => item.version);

    loaderSelect.innerHTML = normalized.map((item, index) =>
      `<option value="${escapeAttr(item.version)}">${escapeHtml(item.version)}${item.stable ? ' · Estable' : ' · Preview'}</option>`
    ).join('');
    loaderSelect.value = normalized[0]?.version || '';
  } catch (error) {
    console.error('Error cargando versiones del loader:', error);
    loaderSelect.innerHTML = '<option value="">❌ No se pudieron cargar</option>';
  } finally {
    loaderSelect.disabled = false;
  }
}

// ============================================
// TEMA
// ============================================
function loadTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  currentTheme = savedTheme;
  document.getElementById('app').setAttribute('data-theme', savedTheme);
  updateThemeUI();
}

function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.getElementById('app').setAttribute('data-theme', currentTheme);
  localStorage.setItem('theme', currentTheme);
  updateThemeUI();
}

function updateThemeUI() {
  const icon = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  if (icon && label) {
    icon.textContent = currentTheme === 'dark' ? '🌙' : '☀️';
    label.textContent = currentTheme === 'dark' ? 'Oscuro' : 'Claro';
  }
}

function setupThemeToggle() {
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
  document.getElementById('theme-toggle-settings')?.addEventListener('click', toggleTheme);
}

// ============================================
// RAM
// ============================================
function setupRamSlider() {
  const slider = document.getElementById('instancia-ram');
  const display = document.getElementById('ram-display-modal');
  if (!slider) return;
  const savedRam = localStorage.getItem('ram') || '4096';
  slider.value = savedRam;
  updateRamDisplay(slider.value);
  slider.addEventListener('input', (e) => {
    const value = e.target.value;
    updateRamDisplay(value);
    localStorage.setItem('ram', value);
  });
}

function updateRamDisplay(value) {
  const gb = (parseInt(value) / 1024).toFixed(1);
  const display = document.getElementById('ram-display-modal');
  if (display) display.textContent = `${gb} GB`;
}

// ============================================
// LOADER BUTTONS
// ============================================
function setupLoaderButtons() {
  document.querySelectorAll('.loader-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.loader-btn').forEach(b => {
        b.classList.remove('active');
        b.style.background = '#1e293b';
        b.style.color = '#94a3b8';
        b.style.border = '1px solid #1f2937';
      });
      this.classList.add('active');
      this.style.background = '#2563eb';
      this.style.color = 'white';
      this.style.border = 'none';
      selectedLoader = this.dataset.loader;
      
      const info = document.getElementById('loader-info');
      const loaderNames = {
        'vanilla': 'Sin mods - Experiencia vanilla',
        'fabric': 'Fabric - Mods ligeros y modernos',
        'forge': 'Forge - Mods clásicos y compatibilidad',
        'neoforge': 'NeoForge - Mods modernos para Minecraft 1.20.2+'
      };
      info.textContent = loaderNames[selectedLoader] || 'Selecciona un loader';
      loadLoaderVersions();
    });
  });

  document.getElementById('instancia-version')?.addEventListener('change', loadLoaderVersions);
}

// ============================================
// NAVEGACIÓN
// ============================================
function showView(viewId) {
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(`view-${viewId}`);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-btn[data-view]').forEach(el => el.classList.remove('active'));
  const navBtn = document.querySelector(`[data-view="${viewId}"]`);
  if (navBtn) navBtn.classList.add('active');
  currentView = viewId;
  if (viewId === 'instances') loadInstances();
}

function setupEventListeners() {
  // Navegación
  document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view) showView(view);
    });
  });
  
  // Búsqueda
  document.getElementById('search-btn')?.addEventListener('click', searchModpacks);
  document.getElementById('search-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') (document.getElementById('explore-type')?.value === 'mod' ? searchMods() : searchModpacks());
  });
  
  // Filtros
  document.querySelectorAll('.filters-container select').forEach(select => {
    select.addEventListener('change', () => {
      if (document.getElementById('search-input').value.trim()) {
        searchModpacks();
      }
    });
  });
  document.getElementById('mod-instance-select')?.addEventListener('change', () => {
    const path = document.getElementById('mod-instance-select').value;
    loadInstalledMods(path);
    if (document.getElementById('search-input')?.value.trim()) searchMods();
  });
  document.getElementById('btn-check-mod-updates')?.addEventListener('click', checkModUpdates);
  document.getElementById('btn-update-all-mods')?.addEventListener('click', updateAllMods);
  
  // Acciones rápidas
  document.getElementById('action-explorar')?.addEventListener('click', () => {
    document.querySelector('[data-target="page-mods"]')?.click();
  });
  document.getElementById('action-instalar')?.addEventListener('click', () => {
    document.querySelector('[data-target="page-mods"]')?.click();
  });
  document.getElementById('action-crear')?.addEventListener('click', abrirModal);
  document.getElementById('btn-crear-instancia-header')?.addEventListener('click', abrirModal);
  document.getElementById('btn-nueva-instancia')?.addEventListener('click', abrirModal);
  document.getElementById('btn-explorar')?.addEventListener('click', () => {
    document.querySelector('[data-target="page-mods"]')?.click();
  });
  document.getElementById('btn-jugar')?.addEventListener('click', () => {
    mostrarMensaje('🎮 Selecciona una instancia para jugar');
  });
  document.getElementById('btn-refresh')?.addEventListener('click', loadInstances);
  document.getElementById('btn-importar')?.addEventListener('click', () => {
    mostrarMensaje('📥 Función de importación próximamente');
  });
  
  // Autenticación
  document.getElementById('login-offline-btn')?.addEventListener('click', loginOffline);
  document.getElementById('logout-btn')?.addEventListener('click', logout);
  
  // Modal
  document.getElementById('modal-close')?.addEventListener('click', cerrarModal);
  document.getElementById('btn-cancelar-modal')?.addEventListener('click', cerrarModal);
  document.getElementById('modal-crear-instancia')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) cerrarModal();
  });
  document.getElementById('btn-crear-instancia')?.addEventListener('click', crearInstancia);
  
  // Modal de instalación
  document.getElementById('modal-instalar-close')?.addEventListener('click', cerrarModalInstalacion);
  document.getElementById('btn-cancelar-instalacion')?.addEventListener('click', cerrarModalInstalacion);
  document.getElementById('btn-confirmar-instalacion')?.addEventListener('click', confirmarInstalacion);
  document.getElementById('instancia-nombre-instalacion')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') confirmarInstalacion();
  });
  document.getElementById('modal-instalar-modpack')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) cerrarModalInstalacion();
  });
}

// ============================================
// MODAL CREAR INSTANCIA
// ============================================
function abrirModal() {
  const modal = document.getElementById('modal-crear-instancia');
  const input = document.getElementById('instancia-nombre');
  modal.classList.add('show');
  modal.style.display = 'flex';
  document.getElementById('form-crear-instancia').style.display = 'block';
  document.getElementById('modal-loading').style.display = 'none';
  if (input) {
    input.value = '';
    setTimeout(() => {
      input.focus();
      input.select();
    }, 200);
  }
  // Cargar última versión si está disponible
  loadLatestVersion();
}

function cerrarModal() {
  const modal = document.getElementById('modal-crear-instancia');
  modal.classList.remove('show');
  modal.style.display = 'none';
  document.getElementById('form-crear-instancia').style.display = 'block';
  document.getElementById('modal-loading').style.display = 'none';
}

async function crearInstancia() {
  const nombreInput = document.getElementById('instancia-nombre');
  const nombre = nombreInput?.value?.trim();
  if (!nombre) {
    mostrarMensaje('⚠️ Por favor, ingresa un nombre para la instancia');
    nombreInput?.focus();
    return;
  }
  
  let version = document.getElementById('instancia-version')?.value || '1.20.4';
  // Si seleccionó "Última versión", usar la versión real
  if (version === 'latest') {
    const select = document.getElementById('instancia-version');
    version = select?.dataset?.latest || '1.21.1';
    console.log(`📦 Usando última versión: ${version}`);
  }
  
  const ram = parseInt(document.getElementById('instancia-ram')?.value || '4096');
  
  document.getElementById('form-crear-instancia').style.display = 'none';
  document.getElementById('modal-loading').style.display = 'block';
  
  try {
    const result = await window.launcherAPI.crearInstanciaPersonalizada({
      nombre: nombre,
      version: version,
      loader: selectedLoader || 'vanilla',
      loaderVersion: selectedLoader === 'vanilla' ? null : (document.getElementById('instancia-loader-version')?.value || null),
      ram: ram
    });
    
    if (result.success) {
      mostrarMensaje(`✅ Instancia "${nombre}" creada correctamente`);
      cerrarModal();
      loadInstances();
      updateRightSidebar();
    } else {
      mostrarMensaje('❌ Error al crear instancia: ' + (result.error || 'Error desconocido'));
    }
  } catch (error) {
    console.error('❌ Error creando instancia:', error);
    mostrarMensaje('❌ Error: ' + error.message);
  } finally {
    document.getElementById('form-crear-instancia').style.display = 'block';
    document.getElementById('modal-loading').style.display = 'none';
  }
}

// ============================================
// MODAL INSTALAR MODPACK
// ============================================
let pendingInstallId = null;

function abrirModalInstalacion(projectId) {
  pendingInstallId = projectId;
  const modal = document.getElementById('modal-instalar-modpack');
  const input = document.getElementById('instancia-nombre-instalacion');
  const modItem = document.querySelector(`.install-btn[data-id="${projectId}"]`);
  if (modItem) {
    const card = modItem.closest('.mod-item');
    const title = card?.querySelector('.mod-details h4')?.textContent || 'Modpack';
    input.placeholder = title;
    input.value = title;
  }
  modal.classList.add('show');
  modal.style.display = 'flex';
  document.getElementById('form-instalar-modpack').style.display = 'block';
  document.getElementById('modal-instalar-loading').style.display = 'none';
  input.focus();
  input.select();
}

function cerrarModalInstalacion() {
  const modal = document.getElementById('modal-instalar-modpack');
  modal.classList.remove('show');
  modal.style.display = 'none';
  document.getElementById('form-instalar-modpack').style.display = 'block';
  document.getElementById('modal-instalar-loading').style.display = 'none';
  pendingInstallId = null;
}

async function confirmarInstalacion() {
  const input = document.getElementById('instancia-nombre-instalacion');
  const nombre = input.value.trim();
  if (!nombre) {
    mostrarMensaje('⚠️ Por favor, ingresa un nombre para la instancia');
    input.focus();
    return;
  }
  const projectId = pendingInstallId;
  if (!projectId) {
    mostrarMensaje('❌ Error: No se encontró el modpack');
    return;
  }
  document.getElementById('form-instalar-modpack').style.display = 'none';
  document.getElementById('modal-instalar-loading').style.display = 'block';
  
  try {
    const packInfo = await window.launcherAPI.getModrinthModpack(projectId);
    if (!packInfo.latestVersion) {
      mostrarMensaje('❌ No se encontraron versiones para este modpack');
      cerrarModalInstalacion();
      return;
    }
    const installData = {
      platform: 'modrinth',
      projectId: projectId,
      versionId: packInfo.latestVersion.id,
      instanceName: nombre
    };
    mostrarMensaje(`⬇️ Instalando ${packInfo.title}...`);
    window.launcherAPI.onInstallProgress((progress) => {
      console.log('Progreso:', progress);
      if (progress.stage === 'complete') {
        mostrarMensaje(`✅ ${packInfo.title} instalado correctamente!`);
      }
    });
    const result = await window.launcherAPI.installModpack(installData);
    if (result.success) {
      mostrarMensaje(`✅ ${packInfo.title} instalado correctamente!`);
      cerrarModalInstalacion();
      loadInstances();
      updateRightSidebar();
    } else {
      mostrarMensaje('❌ Error al instalar: ' + (result.error || 'Error desconocido'));
    }
  } catch (error) {
    console.error('Error instalando modpack:', error);
    mostrarMensaje('❌ Error al instalar: ' + error.message);
  } finally {
    document.getElementById('form-instalar-modpack').style.display = 'block';
    document.getElementById('modal-instalar-loading').style.display = 'none';
    cerrarModalInstalacion();
  }
}

// ============================================
// BÚSQUEDA DE MODPACKS
// ============================================
async function searchModpacks() {
  const input = document.getElementById('search-input');
  const query = input?.value?.trim() || 'popular';
  const category = document.getElementById('filter-category')?.value || '';
  const loader = document.getElementById('filter-loader')?.value || '';
  const version = document.getElementById('filter-version')?.value || '';
  
  const loading = document.getElementById('search-loading');
  const resultsContainer = document.getElementById('search-results');
  if (loading) loading.style.display = 'block';
  if (resultsContainer) resultsContainer.innerHTML = '';
  
  try {
    const filters = {};
    if (category) filters.categories = [category];
    if (loader) filters.loaders = [loader];
    if (version) filters.versions = [version];
    const results = await window.launcherAPI.searchModrinth(query, 20, filters);
    displaySearchResults(results);
  } catch (error) {
    console.error('Error buscando modpacks:', error);
    if (resultsContainer) {
      resultsContainer.innerHTML = `
        <div class="empty-state">
          <i class="fa-solid fa-circle-exclamation"></i>
          <h3>Error al buscar</h3>
          <p>${error.message || 'Intenta de nuevo más tarde'}</p>
        </div>
      `;
    }
  } finally {
    if (loading) loading.style.display = 'none';
  }
}

function displaySearchResults(results) {
  const container = document.getElementById('search-results');
  if (!container) return;
  if (results.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-search"></i>
        <h3>No se encontraron modpacks</h3>
        <p>Prueba con otros términos de búsqueda o quita algunos filtros</p>
      </div>
    `;
    return;
  }
  
  const sortType = document.getElementById('filter-sort')?.value || 'downloads';
  const sortedResults = [...results];
  if (sortType === 'downloads') {
    sortedResults.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
  } else if (sortType === 'title') {
    sortedResults.sort((a, b) => a.title.localeCompare(b.title));
  }
  
  container.innerHTML = sortedResults.map((pack, index) => {
    const colors = ['#3b82f6', '#8b5cf6', '#ef4444', '#10b981', '#f59e0b', '#ec4899'];
    const color = colors[index % colors.length];
    const categories = pack.categories?.slice(0, 3) || [];
    const categoryTags = categories.map(c => `<span class="mod-tag">${c}</span>`).join('');
    
    // Mostrar badge del loader
    let loaderBadge = '';
    if (pack.loaders && pack.loaders.length > 0) {
      const loader = pack.loaders[0];
      if (loader === 'fabric') {
        loaderBadge = `<span style="background: #1bd96a; color: white; padding: 0 8px; border-radius: 4px; font-size: 10px;">Fabric</span>`;
      } else if (loader === 'forge' || loader === 'neoforge') {
        loaderBadge = `<span style="background: #f16436; color: white; padding: 0 8px; border-radius: 4px; font-size: 10px;">${loader === 'neoforge' ? 'NeoForge' : 'Forge'}</span>`;
      }
    }
    
    return `
      <div class="mod-item" style="animation: fadeIn 0.3s ease ${index * 0.05}s;">
        <div class="mod-info">
          <div class="mod-icon" style="background: ${color};"><i class="fa-solid fa-cubes"></i></div>
          <div class="mod-details">
            <h4>${pack.title}</h4>
            <p>${pack.description ? pack.description.substring(0, 120) + '...' : 'Sin descripción'}</p>
            <div class="mod-stats">
              <span><i class="fa-solid fa-download"></i> ${(pack.downloads || 0).toLocaleString()}</span>
              <span><i class="fa-solid fa-user"></i> ${pack.author || 'Desconocido'}</span>
              ${loaderBadge}
              <span style="background: #2563eb; color: white; padding: 0 8px; border-radius: 4px; font-size: 10px;">Modrinth</span>
            </div>
            ${categoryTags ? `<div class="mod-tags">${categoryTags}</div>` : ''}
          </div>
        </div>
        <div class="mod-action">
          <button class="btn-primary install-btn" data-id="${pack.id}" style="padding: 6px 15px; font-size: 12px;">
            <i class="fa-solid fa-download"></i> Instalar
          </button>
        </div>
      </div>
    `;
  }).join('');
  
  document.querySelectorAll('.install-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      abrirModalInstalacion(this.dataset.id);
    });
  });
}

// ============================================
// MODS 2.7
// ============================================
async function loadModInstanceSelector() {
  const select = document.getElementById('mod-instance-select');
  if (!select) return;
  const instances = await window.launcherAPI.getInstances();
  select.innerHTML = '<option value="">Selecciona una instancia para instalar mods</option>' +
    instances.map(i => `<option value="${escapeAttr(i.path)}">${escapeHtml(i.name)}</option>`).join('');
  const panel = document.getElementById('installed-mods-panel');
  if (panel && select.value) panel.style.display = 'block';
}

function updateExploreMode() {
  const type = document.getElementById('explore-type')?.value || 'modpack';
  const select = document.getElementById('mod-instance-select');
  const importBtn = document.getElementById('btn-importar');
  const searchLoadingText = document.querySelector('#search-loading p');
  if (select) select.style.display = type === 'mod' ? 'block' : 'none';
  if (importBtn) importBtn.innerHTML = type === 'modpack' ? '<i class="fa-solid fa-file-import"></i> Importar ZIP' : '<i class="fa-solid fa-folder-open"></i> Abrir instancia';
  if (searchLoadingText) searchLoadingText.textContent = type === 'mod' ? 'Buscando mods...' : 'Buscando modpacks...';
  if (type === 'mod') {
    document.getElementById('installed-mods-panel')?.style.setProperty('display', 'block');
    loadModInstanceSelector();
    searchMods();
  } else {
    document.getElementById('installed-mods-panel')?.style.setProperty('display', 'none');
    searchModpacks();
  }
}

async function searchMods() {
  const input = document.getElementById('search-input');
  const resultsContainer = document.getElementById('search-results');
  const loading = document.getElementById('search-loading');
  if (loading) loading.style.display = 'block';
  if (resultsContainer) resultsContainer.innerHTML = '';
  try {
    const category = document.getElementById('filter-category')?.value || '';
    const loader = document.getElementById('filter-loader')?.value || '';
    const version = document.getElementById('filter-version')?.value || '';
    const filters = {};
    if (category) filters.categories = [category];
    if (loader && loader !== 'vanilla') filters.loaders = [loader];
    if (version) filters.versions = [version];
    const results = await window.launcherAPI.searchModrinthMods(input?.value?.trim() || '', 24, filters);
    const select = document.getElementById('mod-instance-select');
    const instancePath = select?.value || '';
    if (!results.length) {
      resultsContainer.innerHTML = '<div class="empty-state"><i class="fa-solid fa-magnifying-glass"></i><h3>No se encontraron mods</h3><p>Prueba otra búsqueda o cambia los filtros.</p></div>';
    } else {
      resultsContainer.innerHTML = results.map((mod, index) => `
        <div class="mod-item" style="animation:fadeIn .3s ease ${index * .04}s;">
          <div class="mod-info">
            <div class="mod-icon" style="background:var(--accent);"><i class="fa-solid fa-cube"></i></div>
            <div class="mod-details">
              <h4>${escapeHtml(mod.title)}</h4>
              <p>${escapeHtml((mod.description || 'Sin descripción').slice(0, 150))}${(mod.description || '').length > 150 ? '…' : ''}</p>
              <div class="mod-stats"><span><i class="fa-solid fa-download"></i> ${(mod.downloads||0).toLocaleString()}</span><span>${escapeHtml(mod.author || 'Desconocido')}</span><span style="background:#2563eb;color:white;padding:0 8px;border-radius:4px;font-size:10px;">Modrinth</span></div>
            </div>
          </div>
          <div class="mod-action"><button class="btn-primary mod-install-btn" data-id="${escapeAttr(mod.id)}" ${instancePath ? '' : 'disabled title="Selecciona una instancia"'}><i class="fa-solid fa-download"></i> Instalar</button></div>
        </div>`).join('');
      resultsContainer.querySelectorAll('.mod-install-btn').forEach(btn => btn.addEventListener('click', async () => {
        const path = document.getElementById('mod-instance-select')?.value;
        if (!path) return mostrarMensaje('⚠️ Selecciona una instancia primero');
        btn.disabled = true; btn.textContent = 'Instalando...';
        try {
          const result = await window.launcherAPI.installModrinthMod({ instancePath: path, projectId: btn.dataset.id });
          mostrarMensaje(result?.success ? `✅ ${result.file} instalado` : `❌ ${result?.error || 'No se pudo instalar el mod'}`);
          await loadInstalledMods(path);
        } catch (error) { mostrarMensaje('❌ ' + error.message); }
        btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-download"></i> Instalar';
      }));
    }
    if (instancePath) await loadInstalledMods(instancePath);
  } catch (error) {
    if (resultsContainer) resultsContainer.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-exclamation"></i><h3>Error al buscar</h3><p>${escapeHtml(error.message || 'Intenta de nuevo más tarde')}</p></div>`;
  } finally { if (loading) loading.style.display = 'none'; }
}

let installedModsCache = [];
let installedModsPath = '';

function renderInstalledMods() {
  const list = document.getElementById('installed-mods-list');
  const count = document.getElementById('installed-mod-count');
  const filter = (document.getElementById('installed-mod-filter')?.value || '').trim().toLowerCase();
  const status = document.getElementById('installed-mod-status')?.value || 'all';
  if (!list) return;
  const filtered = installedModsCache.filter(mod => {
    const name = String(mod.title || mod.activeFile || mod.file || '').toLowerCase();
    const haystack = `${name} ${String(mod.version || mod.version_number || '')}`.toLowerCase();
    if (filter && !haystack.includes(filter)) return false;
    if (status === 'enabled' && mod.disabled) return false;
    if (status === 'disabled' && !mod.disabled) return false;
    if (status === 'managed' && !mod.projectId) return false;
    if (status === 'local' && mod.projectId) return false;
    return true;
  });
  if (count) count.textContent = `${filtered.length}/${installedModsCache.length} mods`;
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state"><i class="fa-solid fa-filter-circle-xmark"></i><h3>No hay mods que coincidan</h3><p>Prueba otro filtro o cambia el estado seleccionado.</p></div>';
    return;
  }
  list.innerHTML = filtered.map(mod => `
    <div data-mod-row="1" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:8px;">
      <div style="min-width:0"><strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(mod.title || mod.activeFile)}</strong><span style="font-size:11px;color:${mod.disabled ? 'var(--orange)' : 'var(--text-muted)'};">${mod.disabled ? 'Desactivado' : 'Activo'} · ${mod.projectId ? 'Gestionado por Modrinth' : 'Archivo local'}${mod.version ? ` · ${escapeHtml(mod.version)}` : ''}</span></div>
      <div style="display:flex;gap:6px;flex-shrink:0;"><button class="btn-secondary mod-toggle-btn" data-file="${escapeAttr(mod.file)}" data-enabled="${mod.disabled ? '1':'0'}" style="padding:5px 9px;">${mod.disabled ? 'Activar' : 'Desactivar'}</button><button class="btn-danger mod-remove-btn" data-file="${escapeAttr(mod.file)}" style="padding:5px 9px;"><i class="fa-solid fa-trash"></i></button></div>
    </div>`).join('');
  list.querySelectorAll('.mod-toggle-btn').forEach(btn => btn.addEventListener('click', async () => {
    const enabled = btn.dataset.enabled === '1';
    const r = await window.launcherAPI.toggleInstanceMod(installedModsPath, btn.dataset.file, enabled);
    mostrarMensaje(r?.success ? (enabled ? '✅ Mod activado' : '✅ Mod desactivado') : '❌ ' + (r?.error || 'No se pudo modificar el mod'));
    await loadInstalledMods(installedModsPath);
  }));
  list.querySelectorAll('.mod-remove-btn').forEach(btn => btn.addEventListener('click', async () => {
    if (!confirm(`¿Eliminar ${btn.dataset.file}?`)) return;
    const r = await window.launcherAPI.removeInstanceMod(installedModsPath, btn.dataset.file);
    mostrarMensaje(r?.success ? '✅ Mod eliminado' : '❌ ' + (r?.error || 'No se pudo eliminar'));
    await loadInstalledMods(installedModsPath);
  }));
}

async function loadInstalledMods(instancePath) {
  const panel = document.getElementById('installed-mods-panel');
  const subtitle = document.getElementById('installed-mods-subtitle');
  if (!panel) return;
  installedModsPath = instancePath || '';
  panel.style.display = 'block';
  if (!instancePath) {
    installedModsCache = [];
    if (subtitle) subtitle.textContent = 'Selecciona una instancia.';
    renderInstalledMods();
    return;
  }
  const selected = document.querySelector('#mod-instance-select option:checked')?.textContent || 'Instancia';
  if (subtitle) subtitle.textContent = selected;
  try {
    installedModsCache = await window.launcherAPI.listInstanceMods(instancePath);
  } catch (error) {
    installedModsCache = [];
    mostrarMensaje('❌ No se pudieron cargar los mods: ' + (error.message || error));
  }
  const status = document.getElementById('installed-mod-list-status');
  if (status) {
    status.style.display = 'block';
    status.textContent = installedModsCache.length ? `Instancia: ${selected} · ${installedModsCache.length} mods detectados` : 'No se detectaron archivos .jar en mods/';
  }
  renderInstalledMods();
  const filter = document.getElementById('installed-mod-filter');
  const statusFilter = document.getElementById('installed-mod-status');
  if (filter && !filter.dataset.bound) { filter.addEventListener('input', renderInstalledMods); filter.dataset.bound = '1'; }
  if (statusFilter && !statusFilter.dataset.bound) { statusFilter.addEventListener('change', renderInstalledMods); statusFilter.dataset.bound = '1'; }
}
async function checkModUpdates() {
  const path = document.getElementById('mod-instance-select')?.value;
  if (!path) return mostrarMensaje('⚠️ Selecciona una instancia');
  mostrarMensaje('🔎 Comprobando actualizaciones de mods...');
  const updates = await window.launcherAPI.checkModUpdates(path);
  mostrarMensaje(updates.length ? `🆕 ${updates.length} mod(s) con actualización disponible` : '✅ Todos los mods gestionados están actualizados');
}

async function updateAllMods() {
  const path = document.getElementById('mod-instance-select')?.value;
  if (!path) return mostrarMensaje('⚠️ Selecciona una instancia');
  const button = document.getElementById('btn-update-all-mods');
  if (button) { button.disabled = true; button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Actualizando...'; }
  try {
    const result = await window.launcherAPI.updateInstanceMods(path);
    mostrarMensaje(result.checked ? `✅ ${result.updated} mod(s) actualizado(s)${result.failed ? ` · ${result.failed} con error` : ''}${result.backupsCreated ? ` · ${result.backupsCreated} respaldo(s) creado(s)` : ''}` : '✅ No hay actualizaciones disponibles');
    await loadInstalledMods(path);
  } catch (error) {
    mostrarMensaje('❌ ' + (error.message || 'No se pudieron actualizar los mods'));
  } finally {
    if (button) { button.disabled = false; button.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Actualizar mods'; }
  }
}


// ============================================
// INSTANCIAS
// ============================================
async function loadInstances() {
  try {
    const instances = await window.launcherAPI.getInstances();
    displayInstances(instances);
    updateInstanceCount(instances.length);
    await updateInstanceCardMetadata(instances);
    updateRightSidebar();
  } catch (error) {
    console.error('Error cargando instancias:', error);
  }
}

function displayInstances(instances) {
  const container = document.getElementById('instances-grid');
  if (!container) return;
  if (instances.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-cube"></i>
        <h3>No tienes instancias</h3>
        <p>Explora modpacks o crea una instancia personalizada</p>
        <div style="margin-top: 10px; display: flex; gap: 10px; justify-content: center;">
          <button class="btn-primary" onclick="document.querySelector('[data-target=\\'page-mods\\']')?.click()">
            <i class="fa-solid fa-search"></i> Explorar Modpacks
          </button>
          <button class="btn-secondary" onclick="abrirModal()">
            <i class="fa-solid fa-plus"></i> Crear Instancia
          </button>
        </div>
      </div>
    `;
    return;
  }
  
  const colors = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4'];
  container.innerHTML = instances.map((instance, index) => {
    const color = colors[index % colors.length];
    return `
      <div class="instance-card">
        <h4><i class="fa-solid fa-cube" style="color: ${color};"></i> ${instance.name}</h4>
        <div class="instance-meta">
          <span>📁 ${instance.type || 'Modrinth'}</span>
          <span style="margin-left: 10px;">📅 ${new Date(instance.installedAt).toLocaleDateString()}</span>
          ${instance.loader ? `<span style="margin-left: 10px; background: #1e293b; padding: 0 8px; border-radius: 4px;">${instance.loader}</span>` : ''}
          <span style="margin-left: 10px;">📦 ${instance.version || '?'}</span>
        </div>
        <div class="instance-actions">
          <button class="btn-primary launch-btn" data-path="${instance.path}">
            <i class="fa-solid fa-play"></i> Jugar
          </button>
          <button class="btn-secondary repair-btn" data-path="${instance.path}" title="Reparar">
            <i class="fa-solid fa-wrench"></i>
          </button>
          <button class="btn-secondary duplicate-btn" data-path="${instance.path}" title="Duplicar">
            <i class="fa-solid fa-copy"></i>
          </button>
          <button class="btn-secondary favorite-btn" data-path="${instance.path}" title="Favorito"><i class="fa-solid fa-star"></i></button>
          <button class="btn-secondary config-btn" data-path="${instance.path}" title="Configuración"><i class="fa-solid fa-sliders"></i></button>
          <button class="btn-danger delete-btn" data-path="${instance.path}" title="Eliminar">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
  
  document.querySelectorAll('.launch-btn').forEach(btn => {
    btn.addEventListener('click', async function() {
      const path = this.dataset.path;
      await launchGame(path);
    });
  });
  
  document.querySelectorAll('.repair-btn').forEach(btn => {
    btn.addEventListener('click', async function() {
      mostrarMensaje('🛠️ Reparando instancia...');
      const result = await window.launcherAPI.repairInstance(this.dataset.path);
      mostrarMensaje(result.success ? '✅ Instancia reparada' : '❌ ' + (result.error || 'No se pudo reparar'));
      loadInstances();
    });
  });
  document.querySelectorAll('.duplicate-btn').forEach(btn => {
    btn.addEventListener('click', async function() {
      const name = prompt('Nombre para la copia:');
      if (!name) return;
      const result = await window.launcherAPI.duplicateInstance(this.dataset.path, name);
      mostrarMensaje(result.success ? `✅ ${result.name} creada` : '❌ ' + (result.error || 'No se pudo duplicar'));
      if (result.success) loadInstances();
    });
  });

  document.querySelectorAll('.favorite-btn').forEach(btn => btn.addEventListener('click', async function(){
    const cfg = await window.launcherAPI.getInstanceConfig(this.dataset.path);
    await window.launcherAPI.setInstanceConfig(this.dataset.path, { favorite: !cfg.favorite });
    displayInstances();
    updateRightSidebar();
  }));
  document.querySelectorAll('.config-btn').forEach(btn => btn.addEventListener('click', () => openInstanceConfig(btn.dataset.path)));

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async function() {
      if (confirm('¿Estás seguro de eliminar esta instancia?')) {
        const path = this.dataset.path;
        await window.launcherAPI.deleteInstance(path);
        loadInstances();
        updateRightSidebar();
      }
    });
  });
}


async function updateInstanceCardMetadata(instances) {
  try {
    const configs = await Promise.all(instances.map(i => window.launcherAPI.getInstanceConfig(i.path)));
    instances.forEach((instance, idx) => {
      const btn = document.querySelector(`.favorite-btn[data-path="${CSS.escape(instance.path)}"]`);
      if (btn) btn.classList.toggle('active', !!configs[idx].favorite);
    });
  } catch (e) { console.error('No se pudieron cargar favoritos', e); }
}

async function loadProfiles() {
  const box = document.getElementById('profiles-grid');
  if (!box) return;
  const [profiles, active] = await Promise.all([window.launcherAPI.getProfiles(), window.launcherAPI.getActiveProfile()]);
  box.innerHTML = profiles.map(p => `
    <div class="feature-card">
      <div class="card-head"><div style="display:flex;gap:12px;align-items:center"><div class="card-icon" style="background:${p.color}22;color:${p.color}"><i class="fa-solid fa-layer-group"></i></div><div><h3>${escapeHtml(p.name)}</h3><div class="muted">${escapeHtml(p.description || 'Sin descripción')}</div></div></div>${p.id===active.id?'<span class="chip">Activo</span>':''}</div>
      <div class="actions"><button class="btn-primary profile-select-btn" data-id="${p.id}" ${p.id===active.id?'disabled':''}>${p.id===active.id?'✓ Seleccionado':'Usar perfil'}</button><button class="btn-secondary profile-edit-btn" data-id="${p.id}">Editar</button>${p.id!=='default'?'<button class="btn-delete profile-delete-btn" data-id="'+p.id+'">Eliminar</button>':''}</div>
    </div>`).join('');
  box.querySelectorAll('.profile-select-btn').forEach(b=>b.addEventListener('click', async()=>{ await window.launcherAPI.selectProfile(b.dataset.id); mostrarMensaje('✅ Perfil activo actualizado'); loadProfiles(); displayInstances(); }));
  box.querySelectorAll('.profile-edit-btn').forEach(b=>b.addEventListener('click',()=>openProfileModal(profiles.find(p=>p.id===b.dataset.id))));
  box.querySelectorAll('.profile-delete-btn').forEach(b=>b.addEventListener('click',async()=>{ if(!confirm('¿Eliminar este perfil?'))return; const r=await window.launcherAPI.deleteProfile(b.dataset.id); mostrarMensaje(r.success?'✅ Perfil eliminado':'❌ '+r.error); loadProfiles(); }));
}

let editingProfileId = null;
function openProfileModal(profile=null){ editingProfileId=profile?.id||null; document.getElementById('perfil-modal-title').textContent=profile?'Editar perfil':'Nuevo perfil'; document.getElementById('perfil-name-input').value=profile?.name||''; document.getElementById('perfil-description-input').value=profile?.description||''; document.getElementById('perfil-color-input').value=profile?.color||'#4f8cff'; document.getElementById('modal-perfil').classList.add('show'); }
function closeProfileModal(){ document.getElementById('modal-perfil').classList.remove('show'); editingProfileId=null; }
async function saveProfileForm(){ const data={name:document.getElementById('perfil-name-input').value,description:document.getElementById('perfil-description-input').value,color:document.getElementById('perfil-color-input').value}; const r=editingProfileId?await window.launcherAPI.updateProfile(editingProfileId,data):await window.launcherAPI.createProfile(data); if(r?.error){mostrarMensaje('❌ '+r.error);return;} closeProfileModal(); loadProfiles(); mostrarMensaje('✅ Perfil guardado'); }

async function loadServers(){ const box=document.getElementById('servers-grid'); if(!box)return; const servers=await window.launcherAPI.getServers(); if(!servers.length){box.innerHTML='<div class="feature-card"><h3>No hay servidores guardados</h3><p class="muted" style="margin-top:6px">Añade tu primer servidor para tenerlo disponible al configurar tus instancias.</p></div>';return;} box.innerHTML=servers.map(s=>`<div class="feature-card"><div class="card-head"><div><h3>${escapeHtml(s.name)}</h3><div class="muted">${escapeHtml(s.address)}:${s.port}</div></div><button class="favorite-toggle ${s.favorite?'active':''}" data-id="${s.id}" title="Favorito"><i class="fa-solid fa-star"></i></button></div><div style="margin-top:12px;display:flex;gap:7px;flex-wrap:wrap">${s.version?`<span class="chip">Minecraft ${escapeHtml(s.version)}</span>`:''}<span class="chip">Puerto ${s.port}</span></div><div class="actions"><button class="btn-secondary server-edit-btn" data-id="${s.id}">Editar</button><button class="btn-delete server-delete-btn" data-id="${s.id}">Eliminar</button></div></div>`).join(''); box.querySelectorAll('.server-edit-btn').forEach(b=>b.addEventListener('click',()=>openServerModal(servers.find(s=>s.id===b.dataset.id)))); box.querySelectorAll('.server-delete-btn').forEach(b=>b.addEventListener('click',async()=>{if(!confirm('¿Eliminar servidor?'))return;await window.launcherAPI.deleteServer(b.dataset.id);loadServers();})); box.querySelectorAll('.favorite-toggle').forEach(b=>b.addEventListener('click',async()=>{const srv=servers.find(s=>s.id===b.dataset.id);await window.launcherAPI.updateServer(srv.id,{favorite:!srv.favorite});loadServers();})); }
let editingServerId=null;
function openServerModal(server=null){editingServerId=server?.id||null;document.getElementById('servidor-modal-title').textContent=server?'Editar servidor':'Nuevo servidor';document.getElementById('server-name-input').value=server?.name||'';document.getElementById('server-address-input').value=server?.address||'';document.getElementById('server-port-input').value=server?.port||25565;document.getElementById('server-version-input').value=server?.version||'';document.getElementById('modal-servidor').classList.add('show');}
function closeServerModal(){document.getElementById('modal-servidor').classList.remove('show');editingServerId=null;}
async function saveServerForm(){const data={name:document.getElementById('server-name-input').value,address:document.getElementById('server-address-input').value,port:document.getElementById('server-port-input').value,version:document.getElementById('server-version-input').value};const r=editingServerId?await window.launcherAPI.updateServer(editingServerId,data):await window.launcherAPI.addServer(data);if(r?.error){mostrarMensaje('❌ '+r.error);return;}closeServerModal();loadServers();mostrarMensaje('✅ Servidor guardado');}

let configInstancePath=null;
async function openInstanceConfig(instancePath){ configInstancePath=instancePath; const [cfg,profiles,servers,instances]=await Promise.all([window.launcherAPI.getInstanceConfig(instancePath),window.launcherAPI.getProfiles(),window.launcherAPI.getServers(),window.launcherAPI.getInstances()]); const inst=instances.find(i=>i.path===instancePath); document.getElementById('instance-config-name').textContent=inst?.name||'Instancia'; document.getElementById('instance-config-profile').innerHTML=profiles.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join(''); document.getElementById('instance-config-profile').value=cfg.profileId||profiles[0]?.id||''; document.getElementById('instance-config-ram').value=cfg.ram||4096; document.getElementById('instance-config-java').value=cfg.javaVersion||''; document.getElementById('instance-config-server').innerHTML='<option value="">Ninguno</option>'+servers.map(s=>`<option value="${s.id}">${escapeHtml(s.name)} — ${escapeHtml(s.address)}</option>`).join(''); document.getElementById('instance-config-server').value=cfg.serverId||''; document.getElementById('instance-config-notes').value=cfg.notes||''; document.getElementById('instance-config-jvm').value=cfg.jvmArgs||''; document.getElementById('modal-instancia-config').classList.add('show'); }
function closeInstanceConfig(){document.getElementById('modal-instancia-config').classList.remove('show');configInstancePath=null;}
async function saveInstanceConfig(){if(!configInstancePath)return;await window.launcherAPI.setInstanceConfig(configInstancePath,{profileId:document.getElementById('instance-config-profile').value,ram:document.getElementById('instance-config-ram').value,javaVersion:document.getElementById('instance-config-java').value||null,serverId:document.getElementById('instance-config-server').value||null,notes:document.getElementById('instance-config-notes').value,jvmArgs:document.getElementById('instance-config-jvm').value||''});closeInstanceConfig();displayInstances();mostrarMensaje('✅ Configuración guardada');}

function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m]));}

function updateInstanceCount(count) {
  const el = document.getElementById('profile-instances-count');
  if (el) el.textContent = count;
}

// ============================================
// BARRA LATERAL DERECHA
// ============================================
async function updateRightSidebar() {
  const container = document.getElementById('right-instance-list');
  if (!container) return;
  try {
    const instances = await window.launcherAPI.getInstances();
    const colors = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b'];
    if (instances.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: #6b7280; padding: 20px;"><p style="font-size: 12px;">No hay instancias</p></div>`;
      return;
    }
    container.innerHTML = instances.slice(0, 5).map((instance, index) => {
      const color = colors[index % colors.length];
      return `
        <div class="instance-item">
          <div class="instance-icon" style="background: ${color};"><i class="fa-solid fa-cube"></i></div>
          <div class="instance-info">
            <h4>${instance.name}</h4>
            <p>${instance.type || 'Modrinth'} ${instance.loader ? `(${instance.loader})` : ''}</p>
          </div>
          <button class="btn-play launch-btn-small" data-path="${instance.path}">JUGAR</button>
        </div>
      `;
    }).join('');
    document.querySelectorAll('.launch-btn-small').forEach(btn => {
      btn.addEventListener('click', async function() {
        const path = this.dataset.path;
        const ram = parseInt(localStorage.getItem('ram')) || 4096;
        await launchGame(path, ram);
      });
    });
  } catch (error) {
    console.error('Error actualizando sidebar:', error);
  }
}

// ============================================
// LANZAR JUEGO
// ============================================
async function launchGame(instancePath) {
  mostrarMensaje('🚀 Lanzando Minecraft...');
  try {
    const cfg = await window.launcherAPI.getInstanceConfig(instancePath);
    const result = await window.launcherAPI.launchMinecraft({
      instancePath,
      ram: Number(cfg?.ram || 4096),
      javaVersion: cfg?.javaVersion ?? undefined
    });
    if (result?.success) mostrarMensaje('🎮 Minecraft se está iniciando. Puedes seguir navegando por MineSteam.');
    else mostrarMensaje('❌ ' + (result?.error || 'No se pudo iniciar Minecraft'));
  } catch (error) {
    console.error('Error lanzando Minecraft:', error);
    mostrarMensaje('❌ Error al lanzar: ' + error.message);
  }
}

// ============================================
// AUTENTICACIÓN OFFLINE
// ============================================
async function checkSession() {
  const offlineUser = localStorage.getItem('offlineUser');
  if (offlineUser) updateProfileUI({ name: offlineUser, offline: true });
  else updateProfileUI(null);
}

async function loginOffline() {
  const username = document.getElementById('offline-username')?.value?.trim();
  if (!username) {
    mostrarMensaje('⚠️ Por favor, ingresa un nombre de usuario');
    return;
  }
  try {
    const result = await window.launcherAPI.loginOffline(username);
    if (!result.success) throw new Error(result.error || 'No se pudo iniciar sesión offline');
    localStorage.setItem('offlineUser', username);
    updateProfileUI({ name: username, offline: true });
    mostrarMensaje(`✅ Sesión offline iniciada como ${username}`);
  } catch (error) {
    console.error('Error en login offline:', error);
    mostrarMensaje('❌ Error: ' + error.message);
  }
}

async function logout() {
  localStorage.removeItem('offlineUser');
  try { await window.launcherAPI.logoutOffline(); } catch (_) {}
  updateProfileUI(null);
  mostrarMensaje('Sesión offline cerrada');
}

function updateProfileUI(user) {
  const nameDisplay = document.getElementById('username-display');
  const statusText = document.getElementById('status-text');
  const profileName = document.getElementById('profile-name');
  const profileType = document.getElementById('profile-type');
  const logoutBtn = document.getElementById('logout-btn');

  if (user) {
    nameDisplay.textContent = user.name;
    statusText.textContent = 'Modo offline';
    statusText.style.color = '#f39c12';
    profileName.textContent = user.name;
    profileType.textContent = '🔓 Cuenta offline';
    profileType.style.color = '#f39c12';
    updateProfileAvatar(user.name);
    if (logoutBtn) {
      logoutBtn.style.display = 'inline-flex';
      logoutBtn.textContent = 'Cerrar Sesión';
    }
  } else {
    nameDisplay.textContent = 'Invitado';
    statusText.textContent = 'Modo offline';
    statusText.style.color = '#6b7280';
    profileName.textContent = 'Jugador Offline';
    profileType.textContent = '🔓 Sin sesión activa';
    profileType.style.color = '#6b7280';
    updateProfileAvatar(null);
    if (logoutBtn) logoutBtn.style.display = 'none';
  }
}

// ============================================
// HERRAMIENTAS: INSTANCIAS Y JAVA
// ============================================
async function loadJavaManager() {
  const box=document.getElementById('java-manager-list'); if(!box) return;
  box.innerHTML='<div class="tool-card">Comprobando runtimes...</div>';
  const data=await window.launcherAPI.getJavaStatus();
  box.innerHTML=[8,17,21,25].map(v=>{
    const installed=(data.installed||[]).includes(v);
    const system=Number(data.system||0)>=v;
    return `<div class="tool-card"><div><strong>Java ${v}</strong><p>${system?'Disponible en el sistema':installed?'Instalado en MineSteam':'No instalado'}</p></div><button class="btn-${system||installed?'secondary':'primary'} java-install-btn" data-java="${v}" ${system||installed?'disabled':''}>${system||installed?'✓ Disponible':'Descargar'}</button></div>`;
  }).join('');
  box.querySelectorAll('.java-install-btn').forEach(btn=>btn.addEventListener('click',async()=>{
    btn.disabled=true; btn.textContent='Descargando...';
    const r=await window.launcherAPI.installJava(Number(btn.dataset.java));
    mostrarMensaje(r.success?`✅ Java ${btn.dataset.java} instalado`:'❌ '+(r.error||'Error instalando Java'));
    loadJavaManager();
  }));
}

async function diagnoseInstance(path) {
  const r=await window.launcherAPI.diagnoseInstance(path);
  if(!r.success) return mostrarMensaje('❌ '+r.error);
  const issues=[];
  if(!r.minecraftPresent) issues.push('Minecraft base falta');
  if(r.missingFiles?.length) issues.push(`${r.missingFiles.length} archivo(s) de modpack faltan o están dañados`);
  if(r.javaRequired && r.javaDetected < r.javaRequired) issues.push(`Java ${r.javaRequired} requerido; detectado ${r.javaDetected||'ninguno'}`);
  mostrarMensaje(issues.length?'⚠️ '+issues.join(' · '):'✅ Instancia saludable');
}

// ============================================
// TOAST
// ============================================
function mostrarMensaje(mensaje) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = mensaje;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}


function escapeAttr(value) { return escapeHtml(value).replace(/\"/g, '&quot;').replace(/'/g, '&#39;'); }

console.log('🎮 Launcher renderizado correctamente');