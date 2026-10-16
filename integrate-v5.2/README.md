# INTEGRATE V5.2.0 | EugenIA Lab · Biblioteca Viva
Estado: prueba de concepto paralela, **no activada en producción**.

## Procedencia
- Proyecto original declarado: https://github.com/mreyesg/eugenia-lab-biva
- Repositorio modelo: https://github.com/ricardojuanmorales/eugenia-lab-aplicacion-agentica-1
- Aplicación de referencia: https://web-beta-hazel-49.vercel.app
- Responsables: Manuel de J. Reyes Guzmán, Ph.D.; Ricardo Juan Morales De Jesús, Ph.D.
- El repositorio original no estuvo accesible mediante la conexión, por lo que este repositorio modelo NO es aún un clon verificado del código BIVA.

## Garantías de aislamiento
- No se editan los archivos de la aplicación ni su configuración.
- La integración funciona como paquete documental y adaptador opt-in, sin efectos al importar.
- Por defecto, INTEGRATE está deshabilitado. No llama APIs, no modifica bibliografía y no envía información.
- Validación y promoción sujetas a revisión humana. Sin despliegue, secretos ni merge automáticos.

## Prueba rápida
1. Revisar `activation.json` y `adapter.mjs`.
2. Ejecutar `node integrate-v5.2/smoke-test.mjs` (Node.js 18+).
3. Para una simulación de activación, usar `createIntegrateSession({ enabled: true, dryRun: true })` de `adapter.mjs`; no existe conexión automática con la app.
4. Importar por separado el ZIP portable del paquete Framework V5.2 cuando se disponga de la aplicación INTEGRATE compatible.

### Importante
Activación en esta rama significa configuración disponible para simulación, no importación en el Framework, no despliegue y no implementación de la app original.
