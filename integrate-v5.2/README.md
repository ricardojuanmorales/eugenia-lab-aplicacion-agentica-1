# BIVA + INTEGRATE V5.2 | PO C controlada

**Rama de auditoría, no despliegue.** Origen `mreyesg/eugenia-lab-biva@master`, árbol fuente `919a3a5cdfd85b789d9adeb7ffb8e19ea69dc4a1`.

## Estado verificable
El origen GitHub ahora es accesible en modo lectura. Se ha importado a `biva-source-snapshot/` un **subconjunto exacto de archivos de código web**, sin modificación de su contenido: `web/index.html`, `web/api/generate.js`, `web/api/search.js`, `web/lib/contencion.js`, `web/package.json`, `web/package-lock.json`, `web/README.md`, `web/.env.example` y `scripts/verify.sh`. No constituye un clon íntegro del repositorio: faltan documentación histórica, materiales binarios y otros archivos. No usar como réplica completa ni desplegar automáticamente. La raíz del proyecto original no se ha modificado.

## Perfiles y madurez
- PH: activo, integración tecnológica, seguridad, verificaciones y mantenibilidad.
- IT: activo, trazabilidad de evidencia, bibliometría, DOI real y control de inferencias.
- AT: activo, evaluación de experiencia, interfaz, accesibilidad y sensibilidad cultural.
- N3: **objetivo de integración avanzada**, pendiente de evidencia verificable y aprobación.
- N4: **objetivo de ecosistema gobernado**, no acreditado; exige gobernanza, continuidad, recuperación y transferencia comprobadas.
- Niveles de proyecto, producto y autonomía se evalúan por separado, sin promediarlos ni deducirlos del uso de IA.

## Documentación activa y puertas de avance
Registrar cambios, evidencia, incidencias y revisión de los tres lentes en `bitacora.md`. No ejecutar despliegue ni escritura sobre producción. Mantener secreto y variables reales fuera del repositorio. Antes de activar N3: pruebas de funcionamiento y rastreo de origen de las fuentes. Antes de declarar N4: validar seguridad, recuperación, continuidad, gestión de cambios, transferencia y aprobación humana.

## Verificación propuesta
`cd biva-source-snapshot/web && npm ci && npm run` para inspeccionar scripts, seguido de `bash ../scripts/verify.sh` cuando se verifique compatibilidad de rutas y dependencias. Estas pruebas **no se han ejecutado** en esta rama. Requieren ambiente Node 22 y credenciales de prueba aisladas cuando correspondan.
