# Radiografía del Saqueo y los Bienes Comunes — Jujuy 🗺️

> Mapa colaborativo de conflictos territoriales, extractivismo y defensa comunitaria en la provincia de Jujuy, Argentina.

![Estética Iconoclasistas](https://img.shields.io/badge/estética-Iconoclasistas-FFD700?style=flat-square)
![Leaflet.js](https://img.shields.io/badge/Leaflet.js-1.9.4-228B22?style=flat-square)
![GitHub Pages](https://img.shields.io/badge/Deploy-GitHub%20Pages-1a1a1a?style=flat-square)

---

## Contenido del proyecto

```
MAPA EN VIVO/
├── index.html          — Estructura principal, imports, modal
├── styles.css          — Sistema de diseño completo (modos claro/oscuro, responsive)
├── app.js              — Lógica del mapa, IndexedDB, formulario, feed, Supabase hook
├── schema.sql          — Esquema PostGIS + políticas RLS para Supabase
├── icons/
│   ├── megamineria.svg — Ícono stencil ⛏ extractivismo/salares
│   ├── monocultivo.svg — Ícono stencil 🌾 Yungas/tabaco
│   └── defensa.svg     — Ícono stencil 🛡 resistencia comunitaria
├── README.md
└── BACKEND_GUIDE.md    — Guía para escalar a Supabase/PostGIS
```

---

## Desplegar en GitHub Pages

### 1. Crear repositorio

```bash
git init
git add .
git commit -m "feat: prototipo radiografía del saqueo"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/radiografia-saqueo.git
git push -u origin main
```

### 2. Activar GitHub Pages

1. Ve a **Settings → Pages** en tu repositorio
2. En **Source**, seleccioná **`main` branch / `/ (root)`**
3. Guardá — en ~60 segundos estará disponible en:  
   `https://TU_USUARIO.github.io/radiografia-saqueo`

### 3. Dominio personalizado (opcional)

Creá un archivo `CNAME` en la raíz con tu dominio:
```
radiografia.tuorganizacion.org
```
Luego configurá el DNS con un `CNAME` apuntando a `TU_USUARIO.github.io`.

---

## Probar en móvil (red local)

```bash
# Con Python 3
python -m http.server 8080

# Con Node.js
npx serve . -p 8080
```

Luego abrí en el teléfono: `http://[IP_DE_TU_PC]:8080`  
Encontrá la IP con `ipconfig` (Windows) o `ip addr` (Linux).

> ⚡ **Tip para baja conectividad**: La app funciona en modo offline gracias a IndexedDB.
> Solo se requiere conexión para cargar las teselas del mapa base (OpenStreetMap).
> Para uso 100% offline, considerá agregar un Service Worker (ver sección abajo).

---

## Funcionalidades

| Función | Estado |
|---------|--------|
| Mapa base OSM + capas WMS IDEJuy/IGN | ✅ |
| Marcadores por categoría (stencil SVG) | ✅ |
| Agrupación de marcadores (clustering) | ✅ |
| Dibujo de polígonos/líneas en el mapa | ✅ |
| Formulario modal con fijación de punto | ✅ |
| Compresión automática de imágenes | ✅ |
| Galería de fotos en popup + lightbox | ✅ |
| Feed lateral con scroll y filtros | ✅ |
| Modo claro/oscuro automático | ✅ |
| Persistencia local (IndexedDB) | ✅ |
| Diseño responsive (mobile-first) | ✅ |
| Geolocalización del dispositivo | ✅ |
| Hook para Supabase/PostGIS | ✅ (stub) |

---

## Agregar Service Worker (modo avión completo)

Creá `sw.js`:

```javascript
const CACHE = 'radiografia-v1';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js',
  '/icons/megamineria.svg', '/icons/monocultivo.svg', '/icons/defensa.svg'];

self.addEventListener('install', e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))));

self.addEventListener('fetch', e =>
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))));
```

Registralo al final de `app.js`:

```javascript
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
```

---

## Datos de muestra

El prototipo incluye **5 reportes de ejemplo** en diferentes categorías:
- Exploración de litio en Salinas Grandes
- Desmonte para tabaco en Yungas de Palpalá  
- Corte de ruta 9 por comunidades de la Puna
- Construcción de planta de litio
- Mapeo comunitario participativo

Estos se cargan automáticamente solo si la base de datos local está vacía.

---

## Créditos

- **Estética**: Inspirada en el Colectivo Iconoclasistas ([iconoclasistas.net](https://iconoclasistas.net))
- **Datos cartográficos**: OpenStreetMap contributors, IDEJuy, IGN Argentina
- **Tecnología**: Leaflet.js, Leaflet.MarkerCluster, Leaflet.Draw, browser-image-compression
- **Tipografía**: Inter + JetBrains Mono (Google Fonts)

---

## Licencia

Creative Commons BY-SA 4.0 — Compartí con la misma licencia y citá la fuente.
