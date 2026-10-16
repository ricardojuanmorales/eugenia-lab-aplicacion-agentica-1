# Biblioteca Viva (app web desplegable)

App agentic de las 8 etapas de EugenIA Lab, lista para publicarse como una web app real (fuera de Claude.ai) y compartirse por QR en la presentación del póster.

## Qué es esto

- `index.html`: la app completa (HTML + JS vanilla, sin build step). Corre en el navegador del teléfono.
- `api/generate.js`: función serverless que hace de **proxy seguro** hacia la API de Claude (sugerencias de fricción, pregunta, mapa y divulgación). La clave de la API vive solo aquí, en el servidor, y nunca llega al navegador.
- `api/search.js`: motor de búsqueda bibliométrica. Claude arma una consulta académica, se busca en **OpenAlex** (gratis, sin llave; agrega Crossref, PubMed y más) y Claude anota el aporte de cada artículo real a la investigación. No inventa citas.

A diferencia de la versión artefacto de Claude.ai (`../app/biblioteca_viva_app.html`), esta versión:

- Usa `localStorage` para guardar el progreso (no `window.storage`).
- Llama a `/api/generate` en vez de a `api.anthropic.com` directamente, así que **funciona para cualquiera que escanee el QR**, esté o no logueado en Claude.ai.

## Cómo se despliega en Vercel (gratis)

1. Crea una cuenta en https://vercel.com (puedes entrar con GitHub).
2. Instala la CLI una sola vez:
   ```
   npm install -g vercel
   ```
3. Desde esta carpeta (`web/`):
   ```
   vercel
   ```
   Sigue las preguntas (aceptar los valores por defecto está bien). Esto crea el proyecto y hace un despliegue de prueba.
4. Configura la clave de la API. En el panel de Vercel: **Project → Settings → Environment Variables**, añade:
   - `ANTHROPIC_API_KEY` = tu clave de https://console.anthropic.com
   - (opcional) `CLAUDE_MODEL` = `claude-opus-5` si quieres máxima calidad
5. Despliega a producción, **siempre desde la carpeta `web/`**:
   ```
   vercel --prod
   ```
   Vercel te da una URL pública (algo como `https://biblioteca-viva.vercel.app`).

   > **Aviso importante (2026-07-25).** El proyecto tiene el ajuste **Root Directory en `.`**, que es correcto solo cuando el CLI sube el contenido de `web/`. Si alguien conecta el proyecto a GitHub, cada push desplegaría la **raíz del repositorio**, que no tiene `index.html` ni carpeta `api/`, y producción quedaría en 404 completo. Ya pasó una vez y tumbó el sitio dos horas. Por eso la conexión de Git está **desconectada a propósito**. Si algún día se quiere reconectar, primero hay que poner **Root Directory = `web`** en Project Settings, y a partir de ahí desplegar desde la **raíz del repo** y no desde `web/`. Ver `docs/decisions.md` (2026-07-25).
6. Convierte esa URL en un QR (por ejemplo en https://www.qr-code-generator.com) para el póster.

## Cómo probar localmente

```
npm install -g vercel
vercel dev
```
Crea un archivo `.env.local` (copia de `.env.example`) con tu `ANTHROPIC_API_KEY`. Abre http://localhost:3000.

> Nota: abrir `index.html` directamente con doble clic (sin servidor) hace funcionar la navegación de las 8 etapas y el guardado, pero **no** las sugerencias de IA, porque esas necesitan la función `/api/generate`.

## Modelo de IA

Por defecto se usa `claude-sonnet-5` (buen balance de calidad, costo y latencia para una app pública en el teléfono). Se puede cambiar con la variable de entorno `CLAUDE_MODEL` sin tocar el código.

## Seguridad del costo

El backend solo acepta 5 tareas concretas (fricción, pregunta, mapa, divulgación, notas) con datos estructurados; no es un "Claude gratis" abierto. Aun así, como el QR es público, conviene:

- Vigilar el uso en el panel de https://console.anthropic.com.
- Considerar un límite de gasto mensual en la consola de Anthropic.
- Si hiciera falta, añadir un límite de peticiones (rate limiting) más adelante.
