/**
 * ============================================================
 * RADIOGRAFÍA DEL SAQUEO — app.js
 * Mapa colaborativo de conflictos territoriales · Jujuy, ARG
 * 
 * Arquitectura:
 *   - DB: IndexedDB (idb-wrapper interno) → ready para Supabase/Firebase
 *   - Mapa: Leaflet.js + MarkerCluster + Leaflet.Draw
 *   - Imágenes: browser-image-compression (client-side)
 *   - Estado: módulo singleton ReportStore
 * ============================================================
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
// 0. CONFIGURACIÓN GLOBAL
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  map: {
    center: [-23.35, -65.6],   // Jujuy, Argentina
    zoom: 8,
    minZoom: 6,
    maxZoom: 18,
  },
  db: {
    name: 'radiografia_saqueo',
    version: 1,
    store: 'reportes',
  },
  images: {
    maxFiles: 3,
    maxSizeMB: 5,
    maxWidthOrHeight: 1200,
    useWebWorker: true,
    quality: 0.78,
  },
  wms: {
    idejuy: {
      url: 'https://idujuy.gob.ar/geoserver/ows',
      layers: ['jujuy:departamentos', 'jujuy:hidrografia'],
      attribution: '© IDEJuy Gobierno de Jujuy',
    },
    ign: {
      url: 'https://wms.ign.gob.ar/geoserver/ows',
      layers: ['capabaseargenmap'],
      attribution: '© IGN Argentina',
    },
  },
  // 🔌 Supabase config (para producción - reemplazar valores)
  supabase: {
    enabled: false,                  // Cambiar a true al conectar
    url: 'https://TU_URL.supabase.co',
    anonKey: 'TU_ANON_KEY',
    bucket: 'radiografia-evidencias',
  },
};

// Metadatos de categorías
const CATEGORIES = {
  megamineria: {
    label: 'Megaminería / Salares',
    emoji: '⛏',
    color: '#FFD700',
    icon: 'icons/megamineria.svg',
  },
  monocultivo: {
    label: 'Monocultivo / Yungas',
    emoji: '🌾',
    color: '#b8860b',
    icon: 'icons/monocultivo.svg',
  },
  defensa: {
    label: 'Defensa Comunitaria',
    emoji: '🛡',
    color: '#228B22',
    icon: 'icons/defensa.svg',
  },
  otro: {
    label: 'Otro conflicto',
    emoji: '●',
    color: '#2c3e50',
    icon: null,
  },
};

// ═══════════════════════════════════════════════════════════════
// 1. BASE DE DATOS — IndexedDB
// ═══════════════════════════════════════════════════════════════

const DB = (() => {
  let db = null;

  async function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(CONFIG.db.name, CONFIG.db.version);

      req.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(CONFIG.db.store)) {
          const store = database.createObjectStore(CONFIG.db.store, {
            keyPath: 'id', autoIncrement: false,
          });
          store.createIndex('categoria', 'categoria', { unique: false });
          store.createIndex('fecha', 'fecha', { unique: false });
          store.createIndex('lat', 'lat', { unique: false });
        }
      };

      req.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getAll() {
    await ensureOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CONFIG.db.store, 'readonly');
      const req = tx.objectStore(CONFIG.db.store).getAll();
      req.onsuccess = () => resolve(req.result.reverse()); // más recientes primero
      req.onerror = () => reject(req.error);
    });
  }

  async function add(report) {
    await ensureOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CONFIG.db.store, 'readwrite');
      const req = tx.objectStore(CONFIG.db.store).add(report);
      req.onsuccess = () => resolve(report);
      req.onerror = () => reject(req.error);
    });
  }

  async function remove(id) {
    await ensureOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CONFIG.db.store, 'readwrite');
      const req = tx.objectStore(CONFIG.db.store).delete(id);
      req.onsuccess = resolve;
      req.onerror = () => reject(req.error);
    });
  }

  async function ensureOpen() {
    if (!db) await open();
  }

  return { open, getAll, add, remove };
})();

// ═══════════════════════════════════════════════════════════════
// 2. UTILIDADES
// ═══════════════════════════════════════════════════════════════

/** Genera un ID único (UUID v4 simplificado) */
function generateId() {
  return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

/** Formatea fecha a español local */
function formatDate(isoString) {
  try {
    return new Date(isoString).toLocaleString('es-AR', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return isoString; }
}

/** Muestra un toast de notificación */
function showToast(message, type = 'success', duration = 3000) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast toast--${type} show`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.className = 'toast';
  }, duration);
}

/** Comprime una imagen en el cliente usando browser-image-compression */
async function compressImage(file) {
  if (typeof imageCompression === 'undefined') return file; // fallback
  try {
    return await imageCompression(file, {
      maxSizeMB: CONFIG.images.maxSizeMB,
      maxWidthOrHeight: CONFIG.images.maxWidthOrHeight,
      useWebWorker: CONFIG.images.useWebWorker,
      initialQuality: CONFIG.images.quality,
    });
  } catch {
    return file; // Si falla la compresión, usa original
  }
}

/** Convierte File a Base64 Data URL */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ═══════════════════════════════════════════════════════════════
// 3. ICONOS LEAFLET PERSONALIZADOS
// ═══════════════════════════════════════════════════════════════

function createLeafletIcon(cat) {
  const meta = CATEGORIES[cat] || CATEGORIES.otro;
  const size = 40;

  // Icono con SVG externo si existe, si no fallback emoji
  if (meta.icon) {
    return L.icon({
      iconUrl: meta.icon,
      iconSize: [size, size],
      iconAnchor: [size / 2, size],
      popupAnchor: [0, -size],
      className: 'custom-marker-icon',
    });
  }

  // Fallback: DivIcon con emoji + color
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;
      background:${meta.color};
      border:2.5px solid #1a1a1a;
      border-radius:4px;
      display:flex;align-items:center;justify-content:center;
      font-size:22px;
      box-shadow:2px 2px 0 #1a1a1a;
    ">${meta.emoji}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}

// ═══════════════════════════════════════════════════════════════
// 4. MAPA (Leaflet)
// ═══════════════════════════════════════════════════════════════

let map, markerCluster, drawnItems;
let allMarkers = {}; // id → marker

function initMap() {
  map = L.map('map', {
    center: CONFIG.map.center,
    zoom: CONFIG.map.zoom,
    minZoom: CONFIG.map.minZoom,
    maxZoom: CONFIG.map.maxZoom,
    zoomControl: true,
    attributionControl: true,
  });

  // --- Capa base: OpenStreetMap con opacidad reducida ---
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
    opacity: 0.72,
    maxZoom: 19,
  }).addTo(map);

  // --- Capa WMS: Límites departamentales IGN Argentina ---
  try {
    L.tileLayer.wms('https://wms.ign.gob.ar/geoserver/ows', {
      layers: 'capabaseargenmap',
      format: 'image/png',
      transparent: true,
      opacity: 0.25,
      attribution: '© IGN Argentina',
      version: '1.3.0',
    }).addTo(map);
  } catch (e) {
    console.warn('WMS IGN no disponible:', e.message);
  }

  // --- Capa WMS: IDEJuy (límites dpto. + hidrografía) ---
  try {
    L.tileLayer.wms('https://idujuy.gob.ar/geoserver/ows', {
      layers: 'jujuy:departamentos',
      format: 'image/png',
      transparent: true,
      opacity: 0.35,
      attribution: '© IDEJuy',
      version: '1.1.1',
    }).addTo(map);
  } catch (e) {
    console.warn('WMS IDEJuy no disponible (modo offline):', e.message);
    document.getElementById('layer-wms-badge').textContent = 'IDEJuy ○';
    document.getElementById('layer-wms-badge').title = 'Capas IDEJuy sin conexión';
  }

  // --- Cluster de marcadores ---
  markerCluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 48,
    spiderfyOnMaxZoom: true,
    animate: true,
    animateAddingMarkers: true,
  });
  map.addLayer(markerCluster);

  // --- Capa de dibujo (polígonos/líneas) ---
  drawnItems = new L.FeatureGroup();
  map.addLayer(drawnItems);

  const drawControl = new L.Control.Draw({
    draw: {
      polygon: {
        allowIntersection: false,
        shapeOptions: { color: '#FFD700', weight: 2 },
      },
      polyline: { shapeOptions: { color: '#c0392b', weight: 2.5 } },
      marker: false,
      rectangle: false,
      circle: false,
      circlemarker: false,
    },
    edit: { featureGroup: drawnItems },
  });
  map.addControl(drawControl);

  // Evento: dibujo completado
  map.on(L.Draw.Event.CREATED, (e) => {
    drawnItems.addLayer(e.layer);
  });

  // Evento: clic en mapa para reportar
  map.on('click', onMapClick);
}

// ═══════════════════════════════════════════════════════════════
// 5. FORMULARIO MODAL
// ═══════════════════════════════════════════════════════════════

let formState = {
  lat: null,
  lng: null,
  categoria: null,
  fotos: [],           // Array de { file, base64, compressed }
  isSelecting: false,
};

let tempMarker = null; // Marcador temporal mientras se elige punto

// --- Abrir modal de reporte ---
function openModal(lat, lng) {
  formState = { lat, lng, categoria: null, fotos: [], isSelecting: false };

  document.getElementById('coord-value').textContent =
    `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  // Reset UI
  document.getElementById('report-title').value = '';
  document.getElementById('report-desc').value = '';
  document.getElementById('report-source-name').value = '';
  document.getElementById('photo-preview-grid').innerHTML = '';
  document.querySelectorAll('.category-btn').forEach(b => {
    b.classList.remove('selected');
    b.setAttribute('aria-pressed', 'false');
  });
  document.getElementById('btn-submit').disabled = true;

  // Mostrar
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('report-title').focus();
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
  if (tempMarker) {
    map.removeLayer(tempMarker);
    tempMarker = null;
  }
  exitSelectMode();
}

// --- Modo selección de punto ---
function enterSelectMode() {
  formState.isSelecting = true;
  document.getElementById('btn-reportar').classList.add('is-selecting');
  document.getElementById('btn-reportar').textContent = '🎯 Cancelar selección';
  document.getElementById('selection-hint').classList.add('visible');
  map.getContainer().style.cursor = 'crosshair';
}

function exitSelectMode() {
  formState.isSelecting = false;
  document.getElementById('btn-reportar').classList.remove('is-selecting');
  document.getElementById('btn-reportar').innerHTML = '<span>+</span> Reportar territorio';
  document.getElementById('selection-hint').classList.remove('visible');
  map.getContainer().style.cursor = '';
}

function onMapClick(e) {
  if (!formState.isSelecting) return;
  const { lat, lng } = e.latlng;

  // Marcador temporal
  if (tempMarker) map.removeLayer(tempMarker);
  tempMarker = L.circleMarker([lat, lng], {
    radius: 10,
    color: '#c0392b',
    fillColor: '#FFD700',
    fillOpacity: 0.9,
    weight: 2.5,
  }).addTo(map);

  exitSelectMode();
  openModal(lat, lng);
}

// --- Selección de categoría ---
function initCategoryButtons() {
  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      formState.categoria = btn.dataset.cat;
      document.querySelectorAll('.category-btn').forEach(b => {
        b.classList.remove('selected');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('selected');
      btn.setAttribute('aria-pressed', 'true');
      validateForm();
    });
  });
}

function validateForm() {
  const title = document.getElementById('report-title').value.trim();
  const valid = formState.categoria && title.length >= 4;
  document.getElementById('btn-submit').disabled = !valid;
  return valid;
}

// --- Upload y compresión de fotos ---
async function handlePhotoInput(files) {
  const remaining = CONFIG.images.maxFiles - formState.fotos.length;
  if (remaining <= 0) {
    showToast(`Máximo ${CONFIG.images.maxFiles} fotos permitidas`, 'error');
    return;
  }

  const toProcess = Array.from(files).slice(0, remaining);
  const progressBar = document.getElementById('upload-progress');
  const bar = document.getElementById('progress-bar');
  progressBar.classList.add('visible');

  for (let i = 0; i < toProcess.length; i++) {
    bar.style.width = `${((i) / toProcess.length) * 100}%`;
    let file = toProcess[i];

    if (!file.type.startsWith('image/')) continue;
    if (file.size > CONFIG.images.maxSizeMB * 1024 * 1024 * 2) {
      showToast(`Foto muy grande: ${file.name}`, 'error');
      continue;
    }

    try {
      const compressed = await compressImage(file);
      const base64 = await fileToBase64(compressed);
      formState.fotos.push({ original: file.name, base64, size: compressed.size });
      renderPhotoPreview();
    } catch {
      showToast('Error al procesar imagen', 'error');
    }
  }

  bar.style.width = '100%';
  setTimeout(() => {
    progressBar.classList.remove('visible');
    bar.style.width = '0%';
  }, 600);
}

function renderPhotoPreview() {
  const grid = document.getElementById('photo-preview-grid');
  grid.innerHTML = '';
  formState.fotos.forEach((foto, idx) => {
    const item = document.createElement('div');
    item.className = 'photo-preview-item';
    item.innerHTML = `
      <img src="${foto.base64}" alt="Evidencia ${idx + 1}" loading="lazy" />
      <button class="photo-preview-item__remove" data-idx="${idx}" 
              aria-label="Eliminar foto ${idx + 1}">✕</button>
    `;
    item.querySelector('.photo-preview-item__remove').addEventListener('click', (e) => {
      formState.fotos.splice(idx, 1);
      renderPhotoPreview();
    });
    grid.appendChild(item);
  });
}

// --- Envío del reporte ---
async function submitReport() {
  if (!validateForm()) return;

  const submitBtn = document.getElementById('btn-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Publicando...';

  const sourceAnon = document.getElementById('source-anon').checked;
  const sourceName = document.getElementById('report-source-name').value.trim();

  const report = {
    id: generateId(),
    fecha: new Date().toISOString(),
    lat: formState.lat,
    lng: formState.lng,
    categoria: formState.categoria,
    titulo: document.getElementById('report-title').value.trim(),
    descripcion: document.getElementById('report-desc').value.trim(),
    fotos: formState.fotos.map(f => f.base64),  // En prod: URLs de Supabase Storage
    fuente: sourceAnon ? 'Anónima' : (sourceName || 'Registrada'),
    version: '1.0',
  };

  try {
    // 💾 Guardar en IndexedDB
    await DB.add(report);

    // 🗺️ Agregar marcador al mapa
    addMarkerToMap(report, true);

    // 📋 Actualizar feed
    await refreshFeed();

    closeModal();
    showToast('✅ Reporte publicado en el mapa', 'success');

    // 🔌 Hook para Supabase (cuando CONFIG.supabase.enabled = true)
    if (CONFIG.supabase.enabled) {
      await syncToSupabase(report);
    }

  } catch (err) {
    console.error('Error al guardar reporte:', err);
    showToast('Error al guardar. Intenta de nuevo.', 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Publicar reporte ↗';
  }
}

// ═══════════════════════════════════════════════════════════════
// 6. MARCADORES EN EL MAPA
// ═══════════════════════════════════════════════════════════════

function addMarkerToMap(report, isNew = false) {
  const meta = CATEGORIES[report.categoria] || CATEGORIES.otro;
  const icon = createLeafletIcon(report.categoria);

  const marker = L.marker([report.lat, report.lng], {
    icon,
    title: report.titulo,
    alt: `${meta.label}: ${report.titulo}`,
  });

  // Popup en clic
  marker.bindPopup(() => createPopupContent(report), {
    maxWidth: 340,
    className: 'stencil-popup',
  });

  marker.on('click', () => {
    // Resaltar tarjeta en el feed
    const card = document.querySelector(`[data-report-id="${report.id}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.style.outline = `3px solid ${meta.color}`;
      setTimeout(() => { card.style.outline = ''; }, 1500);
    }
  });

  markerCluster.addLayer(marker);
  allMarkers[report.id] = marker;

  // Animación de entrada para marcadores nuevos
  if (isNew) {
    const el = marker.getElement?.();
    if (el) el.classList.add('new-marker');
    map.flyTo([report.lat, report.lng], Math.max(map.getZoom(), 11), {
      animate: true, duration: 0.8,
    });
  }
}

/** Crea el contenido HTML del popup */
function createPopupContent(report) {
  const meta = CATEGORIES[report.categoria] || CATEGORIES.otro;
  const el = document.createElement('div');
  el.className = 'popup-inner';

  // Galería de fotos
  let galleryHtml = '';
  if (report.fotos && report.fotos.length > 0) {
    galleryHtml = `<div class="popup-gallery" role="list">
      ${report.fotos.map((b64, i) =>
        `<img src="${b64}" alt="Foto ${i + 1}" role="listitem"
             onclick="openLightbox('${report.id}', ${i})"
             loading="lazy" tabindex="0" />`
      ).join('')}
    </div>`;
  }

  el.innerHTML = `
    <div class="popup-header">
      <span class="popup-header__icon">${meta.emoji}</span>
      <div class="popup-header__info">
        <p class="popup-header__cat">${meta.label}</p>
        <p class="popup-header__title">${escapeHtml(report.titulo)}</p>
      </div>
    </div>
    ${galleryHtml}
    <div class="popup-body">
      ${report.descripcion
        ? `<p class="popup-desc">${escapeHtml(report.descripcion)}</p>`
        : ''}
      <div class="popup-meta">
        <span>📅 ${formatDate(report.fecha)}</span>
        <span>📍 ${report.lat.toFixed(5)}, ${report.lng.toFixed(5)}</span>
        <span>👤 ${escapeHtml(report.fuente)}</span>
      </div>
    </div>
  `;
  return el;
}

/** Escapa HTML para prevenir XSS */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Abre un lightbox simple para las fotos del popup */
window.openLightbox = function(reportId, idx) {
  const report = allReports.find(r => r.id === reportId);
  if (!report || !report.fotos[idx]) return;
  
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9999;
    display:flex;align-items:center;justify-content:center;cursor:zoom-out;
  `;
  overlay.innerHTML = `
    <img src="${report.fotos[idx]}" 
         style="max-width:92vw;max-height:92vh;border:2.5px solid #FFD700;border-radius:4px;"
         alt="Foto ${idx + 1}" />
  `;
  overlay.addEventListener('click', () => document.body.removeChild(overlay));
  document.body.appendChild(overlay);
};

// ═══════════════════════════════════════════════════════════════
// 7. FEED LATERAL
// ═══════════════════════════════════════════════════════════════

let allReports = [];
let currentFilter = 'todos';

async function refreshFeed() {
  allReports = await DB.getAll();
  renderFeed();
  updateBadges();
}

function renderFeed() {
  const feed = document.getElementById('feed');
  const filtered = currentFilter === 'todos'
    ? allReports
    : allReports.filter(r => r.categoria === currentFilter);

  if (filtered.length === 0) {
    feed.innerHTML = `
      <div class="feed-empty">
        <span class="feed-empty__icon">🗺️</span>
        ${currentFilter === 'todos'
          ? 'No hay reportes aún.<br />Sé el primero en documentar un conflicto.'
          : `No hay reportes de<br /><strong>${CATEGORIES[currentFilter]?.label || currentFilter}</strong> todavía.`
        }
      </div>
    `;
    return;
  }

  feed.innerHTML = filtered.map(report => {
    const meta = CATEGORIES[report.categoria] || CATEGORIES.otro;
    const thumb = report.fotos?.[0]
      ? `<img class="report-card__thumb" src="${report.fotos[0]}" alt="Evidencia" loading="lazy" />`
      : `<div class="report-card__thumb report-card__thumb--placeholder">${meta.emoji}</div>`;

    return `
      <article class="report-card report-card--${report.categoria}" 
               data-report-id="${report.id}" 
               role="listitem"
               tabindex="0"
               aria-label="${meta.label}: ${escapeHtml(report.titulo)}">
        ${thumb}
        <div class="report-card__body">
          <span class="report-card__tag tag--${report.categoria}">${meta.label}</span>
          <p class="report-card__title">${escapeHtml(report.titulo)}</p>
          <p class="report-card__meta">${formatDate(report.fecha)}</p>
        </div>
      </article>
    `;
  }).join('');

  // Click en tarjeta → volar al marcador
  feed.querySelectorAll('.report-card').forEach(card => {
    const handler = () => {
      const id = card.dataset.reportId;
      const marker = allMarkers[id];
      if (marker) {
        markerCluster.zoomToShowLayer(marker, () => {
          marker.openPopup();
        });
        // En móvil: cerrar sidebar
        if (window.innerWidth <= 768) {
          document.getElementById('sidebar').classList.remove('open');
        }
      }
    };
    card.addEventListener('click', handler);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') handler();
    });
  });
}

function updateBadges() {
  const total = allReports.length;
  document.getElementById('report-total-badge').textContent =
    `${total} ${total === 1 ? 'reporte' : 'reportes'}`;
  document.getElementById('feed-count').textContent =
    `${total} ${total === 1 ? 'reporte registrado' : 'reportes registrados en Jujuy'}`;
}

// ═══════════════════════════════════════════════════════════════
// 8. FILTROS DEL FEED
// ═══════════════════════════════════════════════════════════════

function initFilters() {
  const tabContainer = document.getElementById('filter-tabs');
  tabContainer.addEventListener('click', (e) => {
    const tab = e.target.closest('.filter-tab');
    if (!tab) return;
    
    currentFilter = tab.dataset.filter;
    
    // Actualizar tabs
    tabContainer.querySelectorAll('.filter-tab').forEach(t => {
      t.classList.remove('active', 'active-green');
      t.setAttribute('aria-selected', 'false');
    });
    
    tab.setAttribute('aria-selected', 'true');
    if (currentFilter === 'defensa') {
      tab.classList.add('active-green');
    } else {
      tab.classList.add('active');
    }
    
    renderFeed();

    // Filtrar marcadores visualmente
    filterMarkersOnMap();
  });

  // Leyenda → filtrar
  document.querySelectorAll('[data-filter-legend]').forEach(item => {
    item.addEventListener('click', () => {
      currentFilter = item.dataset.filterLegend;
      document.querySelectorAll('.filter-tab').forEach(t => {
        t.classList.remove('active', 'active-green');
        t.setAttribute('aria-selected', 'false');
      });
      const matchTab = document.querySelector(`.filter-tab[data-filter="${currentFilter}"]`);
      if (matchTab) {
        matchTab.classList.add(currentFilter === 'defensa' ? 'active-green' : 'active');
        matchTab.setAttribute('aria-selected', 'true');
      }
      renderFeed();
      filterMarkersOnMap();
    });
  });
}

function filterMarkersOnMap() {
  if (currentFilter === 'todos') {
    // Mostrar todos los reportes en el mapa
    allReports.forEach(r => {
      const m = allMarkers[r.id];
      if (m && !markerCluster.hasLayer(m)) markerCluster.addLayer(m);
    });
    return;
  }

  allReports.forEach(r => {
    const m = allMarkers[r.id];
    if (!m) return;
    if (r.categoria === currentFilter) {
      if (!markerCluster.hasLayer(m)) markerCluster.addLayer(m);
    } else {
      if (markerCluster.hasLayer(m)) markerCluster.removeLayer(m);
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// 9. SIDEBAR RESPONSIVE (MÓVIL)
// ═══════════════════════════════════════════════════════════════

function initSidebar() {
  const btn = document.getElementById('btn-toggle-sidebar');
  const sidebar = document.getElementById('sidebar');
  
  btn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    btn.textContent = sidebar.classList.contains('open') ? '✕' : '📋';
    btn.setAttribute('aria-expanded', sidebar.classList.contains('open'));
  });

  // Cerrar sidebar al hacer clic fuera (móvil)
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768 &&
        sidebar.classList.contains('open') &&
        !sidebar.contains(e.target) &&
        e.target !== btn) {
      sidebar.classList.remove('open');
      btn.textContent = '📋';
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// 10. DATOS SEMILLA (demo / prototipo)
// ═══════════════════════════════════════════════════════════════

const SEED_DATA = [
  {
    id: 'seed-001',
    fecha: '2024-08-15T10:23:00.000Z',
    lat: -23.648, lng: -66.483,
    categoria: 'megamineria',
    titulo: 'Exploración de litio en Salinas Grandes',
    descripcion: 'Empresas de capital nacional e internacional realizan estudios sísmicos y perforaciones exploratorias sin consulta previa a comunidades kolla y atacameña. Afecta humedales de alta montaña y fuentes de agua para pastoreo de llamas.',
    fotos: [],
    fuente: 'Comunidades del Pueblo Kolla',
  },
  {
    id: 'seed-002',
    fecha: '2024-09-03T14:45:00.000Z',
    lat: -24.182, lng: -65.302,
    categoria: 'monocultivo',
    titulo: 'Desmonte para tabaco en Yungas de Palpalá',
    descripcion: 'Avance de tabacaleras sobre selva montana. Se registran fumigaciones aéreas con imidacloprid a menos de 500m de viviendas. Vecinos reportan mortandad de abejas y contaminación de arroyos.',
    fotos: [],
    fuente: 'Anónima',
  },
  {
    id: 'seed-003',
    fecha: '2024-09-20T09:10:00.000Z',
    lat: -22.967, lng: -65.602,
    categoria: 'defensa',
    titulo: 'Corte de ruta 9 por comunidades de la Puna',
    descripcion: 'Comunidades originarias de la Quebrada de Humahuaca bloquean el paso como medida de fuerza ante la falta de respuesta del gobierno provincial sobre el avance minero en territorios ancestrales.',
    fotos: [],
    fuente: 'Asamblea de Comunidades Andinas',
  },
  {
    id: 'seed-004',
    fecha: '2024-10-05T16:30:00.000Z',
    lat: -24.530, lng: -65.050,
    categoria: 'megamineria',
    titulo: 'Construcción de planta de procesamiento de litio — Puna',
    descripcion: 'Inicio de obras de infraestructura para planta química sin EIA completo. Se observa movimiento de tierra pesada sobre bofedales críticos para la biodiversidad.',
    fotos: [],
    fuente: 'Voluntarios de Jujuy Verde',
  },
  {
    id: 'seed-005',
    fecha: '2024-10-22T11:15:00.000Z',
    lat: -23.900, lng: -65.200,
    categoria: 'defensa',
    titulo: 'Mapeo comunitario de territorios en disputa',
    descripcion: 'Organizaciones locales realizan cartografía participativa para documentar límites ancestrales y recursos naturales afectados por proyectos extractivos. Resultado: 14 polígonos de riesgo identificados.',
    fotos: [],
    fuente: 'Colectivo Tierra y Territorio',
  },
];

/** Carga datos de ejemplo solo si la DB está vacía */
async function loadSeedDataIfEmpty() {
  const existing = await DB.getAll();
  if (existing.length > 0) return;

  for (const item of SEED_DATA) {
    await DB.add(item);
  }
}

// ═══════════════════════════════════════════════════════════════
// 11. INTEGRACIÓN SUPABASE (ESQUELETO PARA PRODUCCIÓN)
// ═══════════════════════════════════════════════════════════════

/**
 * 🔌 syncToSupabase — Hook para sincronización en producción
 * 
 * Para activar:
 *   1. Agregar en index.html:
 *      <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   2. Configurar CONFIG.supabase.enabled = true
 *   3. Completar url y anonKey con los datos de tu proyecto
 * 
 * Esquema PostGIS esperado:
 *   CREATE TABLE reportes (
 *     id TEXT PRIMARY KEY,
 *     fecha TIMESTAMPTZ NOT NULL,
 *     coordenada GEOGRAPHY(POINT, 4326),
 *     categoria TEXT NOT NULL,
 *     titulo TEXT NOT NULL,
 *     descripcion TEXT,
 *     fotos TEXT[],  -- URLs de Supabase Storage
 *     fuente TEXT,
 *     aprobado BOOLEAN DEFAULT false
 *   );
 *   CREATE INDEX ON reportes USING GIST(coordenada);
 */
async function syncToSupabase(report) {
  // Implementación stub — reemplazar con SDK real
  console.log('[Supabase] sync stub — report:', report.id);
  /*
  const { createClient } = supabase;
  const client = createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);

  // 1. Subir fotos a Storage
  const fotoUrls = [];
  for (let i = 0; i < report.fotos.length; i++) {
    const blob = await fetch(report.fotos[i]).then(r => r.blob());
    const { data, error } = await client.storage
      .from(CONFIG.supabase.bucket)
      .upload(`${report.id}/foto_${i}.webp`, blob, { contentType: 'image/webp' });
    if (!error) fotoUrls.push(client.storage.from(CONFIG.supabase.bucket).getPublicUrl(data.path).data.publicUrl);
  }

  // 2. Insertar reporte con coordenada PostGIS
  const { error: insertError } = await client.from('reportes').insert({
    id: report.id,
    fecha: report.fecha,
    coordenada: `POINT(${report.lng} ${report.lat})`,
    categoria: report.categoria,
    titulo: report.titulo,
    descripcion: report.descripcion,
    fotos: fotoUrls,
    fuente: report.fuente,
  });

  if (insertError) throw insertError;
  */
}

// ═══════════════════════════════════════════════════════════════
// 12. EVENT LISTENERS GLOBALES
// ═══════════════════════════════════════════════════════════════

function initEventListeners() {
  // Botón principal Reportar
  document.getElementById('btn-reportar').addEventListener('click', () => {
    if (formState.isSelecting) {
      exitSelectMode();
    } else {
      enterSelectMode();
      // En móvil: cerrar el sidebar para ver el mapa
      if (window.innerWidth <= 768) {
        document.getElementById('sidebar').classList.remove('open');
      }
    }
  });

  // Cerrar modal
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);

  // Cerrar con Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!document.getElementById('modal-overlay').classList.contains('hidden')) {
        closeModal();
      } else if (formState.isSelecting) {
        exitSelectMode();
      }
    }
  });

  // Cierre al clic en overlay
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  // Validación en tiempo real
  document.getElementById('report-title').addEventListener('input', validateForm);

  // Upload de fotos
  const photoInput = document.getElementById('photo-input');
  photoInput.addEventListener('change', (e) => {
    handlePhotoInput(e.target.files);
    e.target.value = ''; // resetear para permitir re-subir mismo archivo
  });

  // Drag & Drop en zona de upload
  const uploadArea = document.getElementById('photo-upload-area');
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
  });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    handlePhotoInput(e.dataTransfer.files);
  });

  // Enviar reporte
  document.getElementById('btn-submit').addEventListener('click', submitReport);

  // Geolocalización del dispositivo (para centrar el mapa)
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        // Solo centrar si está cerca de Jujuy
        if (latitude > -26 && latitude < -21 && longitude > -68 && longitude < -63) {
          map.setView([latitude, longitude], 12);
          showToast('📍 Ubicación detectada', 'success', 2000);
        }
      },
      () => {}, // silencioso si falla
      { timeout: 5000, maximumAge: 60000 }
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// 13. INICIALIZACIÓN PRINCIPAL
// ═══════════════════════════════════════════════════════════════

async function init() {
  try {
    // 1. Abrir DB
    await DB.open();
    
    // 2. Cargar datos semilla (demo)
    await loadSeedDataIfEmpty();
    
    // 3. Inicializar mapa
    initMap();
    
    // 4. Cargar reportes existentes en el mapa
    allReports = await DB.getAll();
    allReports.forEach(r => addMarkerToMap(r, false));
    
    // 5. Inicializar feed
    renderFeed();
    updateBadges();
    
    // 6. Inicializar formulario
    initCategoryButtons();
    
    // 7. Inicializar filtros
    initFilters();
    
    // 8. Inicializar sidebar responsive
    initSidebar();
    
    // 9. Listeners globales
    initEventListeners();
    
    console.info('🗺️ Radiografía del Saqueo iniciada. Reportes cargados:', allReports.length);
    
  } catch (err) {
    console.error('Error de inicialización:', err);
    showToast('⚠️ Error al cargar la aplicación. Recargá la página.', 'error', 5000);
  }
}

// Arrancar cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
