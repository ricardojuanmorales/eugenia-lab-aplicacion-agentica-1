# 🌐 EugenIA Lab · Biblioteca Viva + INTEGRATE V5.2
## El caleidoscopio de una investigación defendible

**Evidencia · creación · tecnología · memoria · transferencia**

> Un proyecto de investigación no necesita abandonar su identidad para dialogar con un Framework. En esta prueba, Biblioteca Viva permanece reconocible y el Framework llega como acompañante trazable, reversible y gobernado por personas.


> 📚 **Documentación canónica activa:** [índice](18_DOCUMENTACION_ACTIVA/README.md) · [bitácora](18_DOCUMENTACION_ACTIVA/Cierres_Reportes/Bitacoras/2026-10-16_Bitacora_BIVA_INTEGRATE.md) · [continuidad](18_DOCUMENTACION_ACTIVA/Primers_Continuidad/2026-10-16_Continuidad_BIVA_INTEGRATE.md) · [índice de cierres](18_DOCUMENTACION_ACTIVA/Cierres_Reportes/Cierres_Sesion/README.md). El cierre fuerte integral está bajo custodia y pendiente de autorización de publicación.

## 📍 Estado de situación · INTEGRATE V5.2
**Corte documental: 16 de octubre de 2026 · Repositorio modelo / rama `main`**

> **Estado general: MONTAJE INTEGRADO · ACTIVACIÓN FUNCIONAL PENDIENTE.** El código y la configuración de demostración están versionados en `main`. Esto no significa que el motor INTEGRATE esté ejecutándose, que exista un despliegue del modelo ni que los niveles N3/N4 estén acreditados.

| Dimensión | Estado verificable | Evidencia / condición |
|---|---|---|
| Montaje en `main` | ✅ Incorporado | [PR #2 fusionado](https://github.com/ricardojuanmorales/eugenia-lab-aplicacion-agentica-1/pull/2), commit `258ea619ad9feccae6a064cb62c263dc39471cfd` |
| Fuente BIVA | 🟡 Copia parcial | Nueve archivos en [`biva-source-snapshot/`](biva-source-snapshot/); **no** es un clon completo |
| Integración paralela | ✅ Configurada | [`activation.json`](integrate-v5.2/activation.json), sin intervención del origen |
| Lentes PH · IT · AT | ✅ Tres declaradas activas | Falta demostrar y documentar su operación y resultados |
| Ejecución efectiva | ⚪ Desactivada | `enabled: false`, `dry_run: true`, `production_write: false` |
| Documentación | ✅ Habilitada | [Bitácora canónica](18_DOCUMENTACION_ACTIVA/Cierres_Reportes/Bitacoras/2026-10-16_Bitacora_BIVA_INTEGRATE.md) y [guía](integrate-v5.2/README.md); mantenerlas al día requiere registrar cada ejecución |
| N3 · integración avanzada | 🟡 Meta declarada | Validación técnica, trazabilidad, pruebas reproducibles y aprobación humana pendientes |
| N4 · ecosistema gobernado | 🔒 No acreditado | Evidencia de gobernanza, recuperación, continuidad y transferencia pendiente |
| Pruebas del snapshot | ⚪ No ejecutadas en esta integración | El script está disponible; no hay resultados verificables de ejecución |
| Despliegue del modelo | ⚪ No realizado | La aplicación BIVA de referencia es independiente de este repositorio |

### 🚦 Semáforo de activación
```text
CÓDIGO EN MAIN     [██████████]  incorporado
LENTES PH / IT / AT [CONFIGURADAS] declaradas activas
EJECUCIÓN          [DETENIDA]    enabled=false / dry_run=true
MADUREZ N3         [OBJETIVO]    evaluación pendiente
MADUREZ N4         [OBJETIVO]    evaluación y gobernanza pendientes
```
*Este semáforo representa estados discretos documentados, no porcentajes de avance, resultados de pruebas ni niveles certificados.*

### 🔍 Próximas puertas de validación
1. **Integridad de la copia:** inventariar y contrastar el repositorio BIVA original completo, incluidas dependencias, documentos y recursos excluidos; resolver la autorización/licencia aplicable.
2. **PH:** ejecutar pruebas controladas del núcleo web y de aislamiento, registrar resultados, dependencias, seguridad y posibilidad de reversión.
3. **IT:** comprobar la trazabilidad del corpus y de los DOI, la consistencia de las afirmaciones y la decisión humana sobre las referencias.
4. **AT:** demostrar una intervención de investigación-creación o visualización que transforme la lectura del problema; documentar evaluación y accesibilidad.
5. **INTEGRATE y niveles:** ejecutar una importación/activación compatible en un entorno aislado, registrar evidencias, evaluar N3 y posteriormente someter N4 a gobernanza y aprobación explícita.

**Cadena de evidencia:** [configuración](integrate-v5.2/activation.json) → [guía de montaje](integrate-v5.2/README.md) → [bitácora](integrate-v5.2/bitacora.md) → pruebas y decisiones humanas.

---

## 🚪 Puertas de entrada
- 📚 [BIVA original](https://github.com/mreyesg/eugenia-lab-biva)
- 🧪 [Rama de montaje experimental](https://github.com/ricardojuanmorales/eugenia-lab-aplicacion-agentica-1/tree/poc/biva-source-verified-integrate-v52-n3-n4)
- 🧬 [Framework Genérico 5.2.0](https://github.com/ricardojuanmorales/framework-proyecto-generico-ia-1)
- 🌐 [Aplicación BIVA de referencia](https://web-beta-hazel-49.vercel.app)
- 🗂️ [Configuración INTEGRATE](integrate-v5.2/activation.json) · [Bitácora canónica](18_DOCUMENTACION_ACTIVA/Cierres_Reportes/Bitacoras/2026-10-16_Bitacora_BIVA_INTEGRATE.md) · [Guía del montaje](integrate-v5.2/README.md)

```text
framework: 5.2.0
module: INTEGRATE
integration: PARALLEL_NON_INVASIVE
lenses: [PH, IT, AT]
target_maturity: [N3, N4]
maturity_evidence: PENDING
documentation: ACTIVE
source_preservation: REQUIRED
production_deployment: FALSE
```

## 🧭 Un problema al centro, tres lentes para interrogarlo

BIVA busca fortalecer el trabajo científico mediante búsqueda bibliométrica evaluada, síntesis de evidencia, matriz de decisión y orientación hacia una investigación defendible. La intervención del Framework no sustituye la curaduría ni la decisión del investigador.

| Lente activa | Pregunta orientadora | Acción en esta POC |
|---|---|---|
| 🔵 **PH · Programador Humanista** | ¿Cómo construirlo responsablemente? | Aislamiento, arquitectura, seguridad y accesibilidad |
| 🟢 **IT · Investigador Transdisciplinario** | ¿Qué sabemos y cómo lo sabemos? | Procedencia, evidencias reales, límites de inferencia y DOI |
| 🟠 **AT · Artista Transdisciplinario** | ¿Qué otras formas revelan el problema? | Visualización, experiencia, narrativas e investigación-creación |

Las lentes no son agentes autónomos ni estatus acreditados por declararlos activos. Son perspectivas funcionales que deben producir evidencia y registrar discrepancias.

## 🧬 Nivel N3 / N4: aspiración gobernada

- **N3, objetivo de proyecto:** demostrar integración avanzada, trabajo replicable, controles, pruebas y decisiones documentadas.
- **N4, objetivo de ecosistema:** justificar continuidad, gobernanza, capacidad de transferencia, mantenimiento y recuperación con evidencia real.
- **Estado verificado:** no se atribuye N3 ni N4 como logro. Se configuran como metas sujetas a evaluación humana. El producto y la autonomía se evalúan separadamente.

> Meta declarada ≠ capacidad demostrada.

## 🏗️ Montaje sin invasión

```text
biva-source-snapshot/
  web/                       Núcleo de BIVA copiado desde master
  scripts/                   Verificador heredado
integrate-v5.2/
  activation.json            Tres lentes y objetivos N3/N4
  README.md                  Protocolo de aislamiento
  bitacora.md                Memoria activa
```

**Proveniencia:** `mreyesg/eugenia-lab-biva`, rama `master`, árbol `919a3a5cdfd85b789d9adeb7ffb8e19ea69dc4a1`. Se ha importado un **snapshot parcial del núcleo web**; no se debe confundir con un clon íntegro del repositorio, ni con un despliegue funcional certificado. Los materiales binarios, otros recursos y la historia Git completa siguen pendientes. El origen no fue modificado.

### Protocolos de esta demostración
1. Preservar el código fuente y registrar toda diferencia.
2. Mantener la configuración `dry_run` aislada de los servicios existentes.
3. Verificar PH, IT y AT con evidencias diferentes y trazables.
4. Registrar las decisiones, límites y hallazgos en la bitácora.
5. Exigir pruebas antes de acreditar N3, y gobernanza y transferencia antes de N4.
6. Nunca inventar citas ni reemplazar decisiones científicas humanas.

## 👥 Autoría y responsabilidad

**Manuel de J. Reyes Guzmán, Ph.D.** y **Ricardo Juan Morales De Jesús, Ph.D.**

Esta prueba de concepto utiliza el Framework como entorno de contraste, no como certificación científica ni como autorización para distribuir recursos de terceros. No se han transferido credenciales ni se ha modificado la aplicación desplegada.

## ♻️ Memoria y evolución

```text
SITUAR → CONTRASTAR (PH + IT + AT) → ACTUAR
   → DOCUMENTAR → VERIFICAR → TRANSFERIR → REVISAR ↺
```

*La documentación permanece abierta y versionada. La hipótesis puede evolucionar; la procedencia no debe perderse.*
