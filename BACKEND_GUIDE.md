# Guía de Escala a Backend Real — Supabase + PostGIS

> Cómo migrar el prototipo de LocalStorage/IndexedDB a una infraestructura serverless con base de datos geoespacial, sin romper la UX ni la estética.

---

## Arquitectura propuesta

```
Frontend (GitHub Pages)
    │
    ├── Leaflet.js (mapa, marcadores, draw)
    └── Supabase JS SDK v2
            │
            ├── Auth   → Autenticación anónima + email
            ├── Storage → Imágenes de evidencia (S3-compatible)
            └── PostGIS → Tabla `reportes` con columna GEOGRAPHY
```

---

## 1. Crear proyecto Supabase

1. Ir a [supabase.com](https://supabase.com) → **New project**
2. Elegir región más cercana (São Paulo / us-east recomendados)
3. Copiar `URL` y `anon public key` del dashboard

---

## 2. Esquema SQL con PostGIS

En el **SQL Editor** de Supabase, ejecutar:

```sql
-- Habilitar extensión PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- Tabla principal de reportes
CREATE TABLE reportes (
  id            TEXT PRIMARY KEY,
  fecha         TIMESTAMPTZ NOT NULL DEFAULT now(),
  coordenada    GEOGRAPHY(POINT, 4326) NOT NULL,
  categoria     TEXT NOT NULL 
                  CHECK (categoria IN ('megamineria','monocultivo','defensa','otro')),
  titulo        TEXT NOT NULL,
  descripcion   TEXT,
  fotos         TEXT[] DEFAULT '{}',  -- URLs de Supabase Storage
  fuente        TEXT DEFAULT 'Anónima',
  aprobado      BOOLEAN DEFAULT false,  -- moderación
  creado_por    UUID REFERENCES auth.users(id),
  version       TEXT DEFAULT '1.0'
);

-- Índice espacial para consultas geoespaciales rápidas
CREATE INDEX idx_reportes_coordenada ON reportes USING GIST(coordenada);
CREATE INDEX idx_reportes_categoria  ON reportes (categoria);
CREATE INDEX idx_reportes_fecha      ON reportes (fecha DESC);

-- Vista con lat/lng extraídos (para Leaflet)
CREATE VIEW reportes_geojson AS
SELECT
  id, fecha, categoria, titulo, descripcion, fotos, fuente, aprobado,
  ST_Y(coordenada::geometry) AS lat,
  ST_X(coordenada::geometry) AS lng,
  ST_AsGeoJSON(coordenada)   AS geojson
FROM reportes
WHERE aprobado = true;

-- RLS: lectura pública, escritura autenticada o anónima
ALTER TABLE reportes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lectura pública de reportes aprobados"
  ON reportes FOR SELECT USING (aprobado = true);

CREATE POLICY "Insertar reportes (anónimo permitido)"
  ON reportes FOR INSERT WITH CHECK (true);
```

---

## 3. Configurar Storage

En **Storage → New bucket**:
- Nombre: `radiografia-evidencias`
- Público: ✅ (para acceso a imágenes sin auth)
- Tamaño máximo: 5 MB
- MIME types: `image/jpeg, image/png, image/webp`

Política de Storage:
```sql
-- Lectura pública
CREATE POLICY "Imágenes públicas"
ON storage.objects FOR SELECT USING (bucket_id = 'radiografia-evidencias');

-- Subida permitida
CREATE POLICY "Subida de evidencias"
ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'radiografia-evidencias');
```

---

## 4. Activar en app.js

En `app.js`, modificar CONFIG:

```javascript
supabase: {
  enabled: true,                             // ← Cambiar a true
  url: 'https://XXXX.supabase.co',           // ← Tu URL
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR...',    // ← Tu anon key
  bucket: 'radiografia-evidencias',
},
```

Agregar el SDK en `index.html` antes de `app.js`:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
```

Descomentar el bloque en la función `syncToSupabase()` en `app.js`.

---

## 5. Cargar reportes desde Supabase al iniciar

Reemplazar la carga inicial en `init()`:

```javascript
// 💡 En producción: obtener reportes desde Supabase
async function loadFromSupabase() {
  const { createClient } = supabase;
  const client = createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);
  
  const { data, error } = await client
    .from('reportes_geojson')
    .select('*')
    .order('fecha', { ascending: false });
    
  if (error) throw error;
  return data;
}
```

---

## 6. Tiempo real con Realtime API

Para que los reportes aparezcan en tiempo real en todos los clientes:

```javascript
function subscribeToRealtime(client) {
  client
    .channel('reportes-changes')
    .on('postgres_changes', 
      { event: 'INSERT', schema: 'public', table: 'reportes' },
      (payload) => {
        const r = payload.new;
        allReports.unshift(r);
        addMarkerToMap(r, true);
        renderFeed();
        showToast(`📍 Nuevo reporte: ${r.titulo}`, 'success');
      }
    )
    .subscribe();
}
```

---

## 7. Moderación de contenido

Flujo recomendado:
1. Nuevos reportes se insertan con `aprobado = false`
2. Moderadores reciben notificación por email (Supabase Edge Functions)
3. Aprueban desde un panel admin simple (otra pantalla de la app)
4. Solo reportes con `aprobado = true` apparecen en la vista pública

```sql
-- Panel admin: aprobar reporte
UPDATE reportes SET aprobado = true WHERE id = 'r-xxx';
```

---

## 8. Consultas geoespaciales útiles

```sql
-- Reportes en radio de 50km de Humahuaca
SELECT * FROM reportes_geojson
WHERE ST_DWithin(
  coordenada,
  ST_MakePoint(-65.35, -23.2)::geography,
  50000  -- metros
);

-- Conteo por categoría por departamento
SELECT categoria, COUNT(*) 
FROM reportes 
GROUP BY categoria;

-- GeoJSON para exportar a QGIS/uMap
SELECT json_build_object(
  'type', 'FeatureCollection',
  'features', json_agg(
    json_build_object(
      'type', 'Feature',
      'geometry', ST_AsGeoJSON(coordenada)::json,
      'properties', json_build_object(
        'id', id, 'titulo', titulo, 'categoria', categoria, 'fecha', fecha
      )
    )
  )
) FROM reportes WHERE aprobado = true;
```

---

## 9. Costos estimados (Supabase Free Tier)

| Recurso | Free Tier | Suficiente para |
|---------|-----------|-----------------|
| Base de datos | 500 MB | ~50.000 reportes |
| Storage | 1 GB | ~2.000 fotos comprimidas |
| Bandwidth | 2 GB/mes | Uso comunitario normal |
| Realtime | 200 conexiones | ✅ |
| Edge Functions | 500.000 llamadas/mes | ✅ |

> 💡 Para uso comunitario intensivo, el plan Pro ($25/mes) con Storage ampliado es suficiente.

---

## 10. Checklist de producción

- [ ] Variables de entorno en `.env` (no commitear keys)
- [ ] Row Level Security activo en todas las tablas
- [ ] Backup automático habilitado
- [ ] Moderación de contenido configurada
- [ ] HTTPS forzado (GitHub Pages lo hace por defecto)
- [ ] Service Worker para modo offline
- [ ] Rate limiting en inserciones (via Edge Function)
- [ ] Política de privacidad visible en la app
