/**
 * RADIOGRAFÍA DEL SAQUEO — app.js (VERSION 3.1 - REPAIRED)
 */

'use strict';

const CONFIG = {
  map: { center: [-23.35, -65.6], zoom: 8, minZoom: 6, maxZoom: 18 },
  db: { name: 'radiografia_saqueo', version: 1, store: 'reportes' },
  images: { maxFiles: 3, maxSizeMB: 5, maxWidthOrHeight: 1200, useWebWorker: true, quality: 0.78 },
  wms: { idejuy: { url: 'https://ide.jujuy.gob.ar/geoserver/ows', layers: 'jujuy:departamentos' } }
};

const CATEGORIES = {
  megamineria: { label: 'Extracción', emoji: '⛏', color: '#FFD700', icon: 'icons/megamineria.svg' },
  monocultivo: { label: 'Cultivo', emoji: '🌾', color: '#b8860b', icon: 'icons/monocultivo.svg' },
  defensa: { label: 'Defensa', emoji: '🛡', color: '#228B22', icon: 'icons/defensa.svg' },
  territorio: { label: 'Territorio', emoji: '🦙', color: '#8B4513', icon: 'icons/llama.svg' },
  otro: { label: 'Otro', emoji: '●', color: '#2c3e50', icon: null },
};

// 1. BASE DE DATOS
const DB = (() => {
  let dbInstance = null;
  async function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(CONFIG.db.name, CONFIG.db.version);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(CONFIG.db.store)) {
          db.createObjectStore(CONFIG.db.store, { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => { dbInstance = e.target.result; resolve(dbInstance); };
      req.onerror = (e) => reject(e.target.error);
    });
  }
  async function getAll() {
    if (!dbInstance) await open();
    return new Promise((resolve) => {
      const tx = dbInstance.transaction(CONFIG.db.store, 'readonly');
      const req = tx.objectStore(CONFIG.db.store).getAll();
      req.onsuccess = () => resolve(req.result.reverse());
    });
  }
  async function add(report) {
    if (!dbInstance) await open();
    return new Promise((resolve) => {
      const tx = dbInstance.transaction(CONFIG.db.store, 'readwrite');
      tx.objectStore(CONFIG.db.store).add(report);
      tx.oncomplete = () => resolve(report);
    });
  }
  return { open, getAll, add };
})();

// 2. UTILIDADES
function generateId() { return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
function formatDate(iso) { return new Date(iso).toLocaleDateString('es-AR'); }
function showToast(msg) {
  const t = document.getElementById('toast');
  if (t) { t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000); }
}

// 3. MAPA
let map, markerCluster, wmsLayer;
let allMarkers = {};
let allReports = [];
let currentFilter = 'todos';

function initMap() {
  map = L.map('map', { center: CONFIG.map.center, zoom: CONFIG.map.zoom });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM', opacity: 0.7 }).addTo(map);
  wmsLayer = L.tileLayer.wms(CONFIG.wms.idejuy.url, { layers: 'jujuy:departamentos', transparent: true, opacity: 0.3 }).addTo(map);
  markerCluster = L.markerClusterGroup();
  map.addLayer(markerCluster);

  document.getElementById('layer-wms-badge').addEventListener('click', () => {
    if (map.hasLayer(wmsLayer)) { map.removeLayer(wmsLayer); document.getElementById('layer-wms-badge').classList.add('inactive'); }
    else { wmsLayer.addTo(map); document.getElementById('layer-wms-badge').classList.remove('inactive'); }
  });
  map.on('click', (e) => { if (formState.isSelecting) onPoint(e.latlng); });
}

function addMarker(report) {
  const cat = CATEGORIES[report.categoria] || CATEGORIES.otro;
  const icon = L.divIcon({
    className: 'sticker-marker',
    html: `<div class="sticker-container" style="background:${cat.color}">
             <img src="${cat.icon || ''}" style="width:100%;height:100%;opacity:${cat.icon?1:0}" />
             <span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:20px">${cat.icon?'':cat.emoji}</span>
           </div>`,
    iconSize: [42, 42], iconAnchor: [21, 42], popupAnchor: [0, -42]
  });
  const m = L.marker([report.lat, report.lng], { icon }).bindPopup(`<b>${report.titulo}</b><br>${report.descripcion}`);
  markerCluster.addLayer(m);
  allMarkers[report.id] = m;
}

// 4. FEED Y FILTROS
function renderFeed() {
  const filtered = currentFilter === 'todos' ? allReports : allReports.filter(r => r.categoria === currentFilter);
  const feedEl = document.getElementById('feed');
  feedEl.innerHTML = filtered.map(r => `
    <article class="report-card" data-id="${r.id}">
      <div class="report-card__thumb report-card__thumb--placeholder">${CATEGORIES[r.categoria]?.emoji || '📍'}</div>
      <div class="report-card body">
        <span class="report-card__tag tag--${r.categoria}">${CATEGORIES[r.categoria]?.label || r.categoria}</span>
        <p class="report-card__title">${r.titulo}</p>
        <p class="report-card__meta">${formatDate(r.fecha)}</p>
      </div>
    </article>
  `).join('');
  feedEl.querySelectorAll('.report-card').forEach(card => card.addEventListener('click', () => {
    const m = allMarkers[card.dataset.id];
    if (m) markerCluster.zoomToShowLayer(m, () => m.openPopup());
  }));
}

function initFilters() {
  document.getElementById('filter-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-tab');
    if (!btn) return;
    currentFilter = btn.dataset.filter;
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active', 'active-green'));
    btn.classList.add(currentFilter === 'defensa' ? 'active-green' : 'active');
    renderFeed();
  });
}

// 5. FORMULARIO
let formState = { isSelecting: false, lat: null, lng: null, categoria: 'otro' };
function onPoint(latlng) {
  formState.lat = latlng.lat; formState.lng = latlng.lng; formState.isSelecting = false;
  document.getElementById('btn-reportar').classList.remove('is-selecting');
  document.getElementById('btn-reportar').textContent = '+ Reportar';
  document.getElementById('modal-overlay').classList.remove('hidden');
}

async function submitReport() {
  const report = {
    id: generateId(), fecha: new Date().toISOString(), lat: formState.lat, lng: formState.lng,
    categoria: formState.categoria, titulo: document.getElementById('report-title').value,
    descripcion: document.getElementById('report-desc').value, fotos: []
  };
  await DB.add(report);
  allReports.unshift(report);
  addMarker(report);
  renderFeed();
  document.getElementById('modal-overlay').classList.add('hidden');
  showToast('✅ Reporte publicado');
}

// 6. INICIO
async function init() {
  try {
    await DB.open();
    initMap();
    allReports = await DB.getAll();
    if (allReports.length === 0) {
      const seed = { id: 's1', fecha: new Date().toISOString(), lat: -23.6, lng: -65.5, categoria: 'megamineria', titulo: 'Salinas Grandes - Megaminería', descripcion: 'Zona de conflicto activo por la explotación de litio.' };
      await DB.add(seed);
      allReports = [seed];
    }
    allReports.forEach(addMarker);
    renderFeed();
    document.getElementById('report-total-badge').textContent = `${allReports.length} reportes`;
    document.getElementById('feed-count').textContent = `${allReports.length} reportes en lista`;
    initFilters();
    document.getElementById('btn-reportar').addEventListener('click', () => { formState.isSelecting = true; document.getElementById('btn-reportar').classList.add('is-selecting'); document.getElementById('btn-reportar').textContent = 'Cancel'; });
    document.getElementById('btn-submit').addEventListener('click', submitReport);
    document.getElementById('modal-close').addEventListener('click', () => document.getElementById('modal-overlay').classList.add('hidden'));
    document.querySelectorAll('.category-btn').forEach(btn => btn.addEventListener('click', () => {
      formState.categoria = btn.dataset.cat;
      document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    }));
    console.info('🗺️ Radiografía del Saqueo - V3.1 OK');
  } catch (e) {
    console.error('Init error:', e);
  }
}
window.addEventListener('DOMContentLoaded', init);
