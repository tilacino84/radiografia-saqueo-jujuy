-- ═══════════════════════════════════════════════════════════════
-- RADIOGRAFÍA DEL SAQUEO — ESQUEMA DE BASE DE DATOS (PostGIS + RLS)
-- Proyecto: tilacino84/radiografia-saqueo-jujuy
-- ═══════════════════════════════════════════════════════════════

-- 1. EXTENSIONES
-- Habilita el soporte para datos geoespaciales (puntos, líneas, polígonos)
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. TABLA PRINCIPAL: reportes
CREATE TABLE IF NOT EXISTS public.reportes (
    id            TEXT PRIMARY KEY,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Geometría: punto geográfico (WGS84)
    -- Geography es preferible a Geometry para cálculos de distancia en metros en grandes áreas
    coordenada    GEOGRAPHY(POINT, 4326) NOT NULL,
    
    -- Metadatos del conflicto
    categoria     TEXT NOT NULL CHECK (categoria IN ('megamineria', 'monocultivo', 'defensa', 'otro')),
    titulo        TEXT NOT NULL,
    descripcion   TEXT,
    fuente        TEXT DEFAULT 'Anónima',
    
    -- Evidencia (Storage)
    -- Almacena las URLs públicas de las imágenes subidas al bucket
    fotos         TEXT[] DEFAULT '{}',
    
    -- Flujo de Moderación Asíncrona
    -- Por defecto los reportes no son visibles hasta que un moderador los apruebe
    aprobado      BOOLEAN NOT NULL DEFAULT false,
    notas_moderacion TEXT,
    
    -- Atribución (si el usuario está logueado, opcional)
    user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- Versión interna del esquema
    schema_v      TEXT DEFAULT '1.1'
);

-- 3. ÍNDICES ESPACIALES Y DE BÚSQUEDA
-- Optimiza consultas por ubicación (ej: "buscar en un radio de 50km")
CREATE INDEX IF NOT EXISTS idx_reportes_coordenada ON public.reportes USING GIST(coordenada);
-- Optimiza filtrado por categoría y estado de aprobación
CREATE INDEX IF NOT EXISTS idx_reportes_visibilidad ON public.reportes (aprobado, categoria);
-- Optimiza el feed de novedades (orden cronológico)
CREATE INDEX IF NOT EXISTS idx_reportes_fecha ON public.reportes (created_at DESC);

-- 4. VISTA PÚBLICA (GEOJSON READY)
-- Esta vista es la que consume el mapa para mayor seguridad y simplicidad
CREATE OR REPLACE VIEW public.v_reportes_aprobados AS
SELECT 
    id,
    created_at,
    categoria,
    titulo,
    descripcion,
    fuente,
    fotos,
    ST_Y(coordenada::geometry) AS lat, -- Extracción de latitud para Leaflet
    ST_X(coordenada::geometry) AS lng, -- Extracción de longitud para Leaflet
    ST_AsGeoJSON(coordenada)::json AS geojson
FROM public.reportes
WHERE aprobado = true;

-- 5. SEGURIDAD DE FILA (ROW LEVEL SECURITY - RLS)
ALTER TABLE public.reportes ENABLE ROW LEVEL SECURITY;

-- 🛡️ POLÍTICA: Lectura Pública
-- Cualquier persona (incluso sin cuenta) puede ver reportes, pero SOLO los aprobados
CREATE POLICY "Lectura pública de reportes aprobados" 
ON public.reportes 
FOR SELECT 
USING (aprobado = true);

-- ✍️ POLÍTICA: Inserción Anónima (Crowdsourcing)
-- Permite que cualquier persona envíe un reporte (siempre con aprobado=false por defecto)
CREATE POLICY "Envío de reportes anónimos" 
ON public.reportes 
FOR INSERT 
WITH CHECK (true);

-- 🛠️ POLÍTICA: Moderadores (Admin)
-- Solo usuarios con rol 'moderador' (o por ID específico) pueden actualizar 'aprobado'
-- Nota: En Supabase esto suele manejarse vía 'Service Role' o roles personalizados
CREATE POLICY "Moderadores pueden editar todo" 
ON public.reportes 
FOR UPDATE 
USING (auth.jwt() ->> 'email' IN ('TU_EMAIL@EJEMPLO.COM')) -- Reemplazar con lógica real de admin
WITH CHECK (true);

-- 6. DISPARADORES (TRIGGERS)
-- Actualiza automáticamente la columna updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER tr_reportes_updated_at
    BEFORE UPDATE ON public.reportes
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- 7. CONFIGURACIÓN DE STORAGE (BUCKET) - Instrucciones
/*
  Ejecutar esto en la consola de Supabase SQL si no se hace vía UI:
  
  insert into storage.buckets (id, name, public) 
  values ('radiografia-evidencias', 'radiografia-evidencias', true);

  create policy "Subida libre de evidencias"
  on storage.objects for insert
  with check ( bucket_id = 'radiografia-evidencias' );

  create policy "Visualización pública de evidencias"
  on storage.objects for select
  using ( bucket_id = 'radiografia-evidencias' );
*/
