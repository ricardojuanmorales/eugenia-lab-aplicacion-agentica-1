// Función serverless: motor de búsqueda bibliométrica real.
// 1) Claude convierte el contexto + una perspectiva del mapa en una consulta académica
//    (en inglés). El cliente puede enviar su propia consulta y entonces se usa tal cual,
//    sin pasar por el modelo: eso hace la búsqueda reproducible y auditable.
// 2) Se busca en OpenAlex, Europe PMC y Crossref (las tres gratis, sin llave). Se combinan,
//    se intercalan y se deduplican. Artículos REALES, con DOI.
// 3) Claude anota cada artículo con su aporte y la fuerza con que sostiene el componente.
// Nunca se inventan citas: los artículos vienen siempre de las bases, nunca del modelo.
//
// Bases evaluadas empíricamente y DESCARTADAS (2026-07-24), para que una sesión futura no
// las vuelva a proponer sin datos nuevos. Medición con la consulta real del caso
// Plectranthus, ver docs/decisions.md:
//   - PubMed (E-utilities): devolvió 1 resultado y 0 que no estuvieran ya en Europe PMC,
//     porque Europe PMC ya indexa MEDLINE/PubMed. Costaba 2 viajes HTTP y parseo de XML
//     para cero ganancia medible.
//   - Semantic Scholar: HTTP 429 en 5 intentos espaciados a lo largo de ~20 segundos. Sin
//     llave el cupo es compartido entre todo el mundo, así que no es fiable para una app
//     pública por QR.
//   - DOAJ: 0 resultados en la consulta específica de Plectranthus (sí 7 en una consulta
//     amplia). Al ser solo revistas de acceso abierto, falla justo en las búsquedas
//     precisas, que son las que más importan aquí.

import { aplicarContencion, tamanoExcedido } from "../lib/contencion.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
const MAILTO = process.env.OPENALEX_MAILTO || "eugenia.lab@upr.edu";
const MAX_RESULTS = 12;

// Tope del cuerpo entero de la peticion. Anadido el 2026-07-25: este endpoint no tenia
// ninguno, y era el hueco mas grande de los dos. El objeto `contexto` (tema, abstract,
// problema, pregunta principal) va casi entero al prompt de generacion de consulta, asi
// que sin tope cualquiera podia mandar megabytes de texto propio y hacerlos facturar.
// 20000 caracteres es holgado: el caso real mas cargado (abstract largo pegado por el
// investigador mas los cuatro campos de contexto) ronda los 4000.
const MAX_BODY_CHARS = 20000;

// Cuántos caracteres del abstract se conservan. Antes era 900.
//
// Medición sobre 36 abstracts reales de las tres bases (2026-07-24): el límite de 900
// truncaba el 81% de ellos y descartaba en promedio el 43% del texto. En 41% de los
// truncados había valores numéricos (concentraciones, rendimientos, unidades) que
// aparecían SOLO después del carácter 900, así que no llegaban ni al modelo ni a la
// pantalla del investigador. Un abstract cortado a media oración también degrada la ficha
// de lectura (tarea "notas") y la síntesis, que se construyen sobre este campo.
//
// Honestidad sobre el alcance: se comparó la MDE generada con la misma evidencia recortada
// a 900 y a 2500, y NO se observó un aumento medible de valores cuantitativos en los
// criterios (6 y 6 en una corrida pareada). El beneficio demostrado es que el dato deja de
// llegar mutilado, no una mejora comprobada en la redacción de la MDE.
const ABSTRACT_CHARS = 2500;

function s(v) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function truncar(str, n) {
  str = s(str);
  return str.length > n ? str.slice(0, n).trim() + "…" : str;
}

// ---- Llamada a Claude con salida estructurada ----
async function callClaude(system, user, schema, maxTokens) {
  const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens || 1600,
      thinking: { type: "disabled" },
      system,
      output_config: { format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: user }]
    })
  });
  const data = await apiRes.json();
  if (!apiRes.ok || data.type === "error") {
    throw new Error("claude_error");
  }
  if (data.stop_reason === "refusal") {
    throw new Error("claude_refusal");
  }
  // Mismo guard que ya existe en generate.js: una respuesta truncada por max_tokens
  // produce JSON inválido y no debe intentar parsearse ni colarse a medias.
  if (data.stop_reason === "max_tokens") {
    throw new Error("claude_truncated");
  }
  const text = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  try {
    return JSON.parse(text);
  } catch {
    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(cleaned);
  }
}

// Normaliza un DOI a su forma desnuda en minúsculas, para comparar entre fuentes.
function normDoi(d) {
  return s(d).toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").trim();
}

// Intercala N listas (round-robin) conservando el orden de relevancia de cada fuente.
// Así todas quedan representadas al recortar, en vez de que una domine. Se probó ordenar
// por citas en su momento y sesgaba todo hacia OpenAlex, por eso se intercala.
function interleave(listas) {
  const out = [];
  const n = Math.max(0, ...listas.map((l) => l.length));
  for (let i = 0; i < n; i++) {
    for (const l of listas) {
      if (i < l.length) out.push(l[i]);
    }
  }
  return out;
}

// Combina resultados de varias fuentes y elimina duplicados por DOI o, si no hay
// DOI, por título normalizado.
function dedup(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key =
      normDoi(it.doi) ||
      s(it.titulo).toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

// ---- OpenAlex ----
function reconstructAbstract(inv) {
  if (!inv || typeof inv !== "object") return "";
  const positions = [];
  for (const [word, idxs] of Object.entries(inv)) {
    if (Array.isArray(idxs)) {
      for (const i of idxs) positions.push([i, word]);
    }
  }
  positions.sort((a, b) => a[0] - b[0]);
  return positions.map((p) => p[1]).join(" ");
}

// Mapea el tipo de documento de OpenAlex a una etiqueta corta en espanol.
function tipoDoc(t) {
  const m = {
    review: "Revisión",
    article: "Artículo",
    "book-chapter": "Capítulo",
    book: "Libro",
    preprint: "Preprint",
    dataset: "Datos",
    dissertation: "Tesis",
    report: "Informe"
  };
  return m[s(t)] || "";
}

// Los nombres de autor se devuelven SIEMPRE como lista, ademas de la cadena de
// visualizacion. Motivo: reconstruir la lista partiendo la cadena es ambiguo y corrompe
// datos. Un articulo real de Crossref con un solo autor ("Abbey, Lord") es indistinguible
// de dos autores separados por coma, y al exportar a BibTeX o RIS se convertia en dos
// personas inexistentes. Con la lista estructurada de la fuente no hay que adivinar.
function listaAutoresOpenAlex(authorships) {
  if (!Array.isArray(authorships)) return [];
  return authorships.map((a) => a && a.author && a.author.display_name).filter(Boolean);
}

// Cadena corta para mostrar en pantalla, a partir de la lista.
function autoresParaMostrar(names) {
  if (!Array.isArray(names) || names.length === 0) return "";
  if (names.length <= 4) return names.join(", ");
  return names.slice(0, 4).join(", ") + ", et al.";
}

async function searchOpenAlex(query, opts) {
  const desde = (opts && opts.desdeAnio) || 0;
  const filtros = ["has_abstract:true"];
  if (desde) filtros.push("from_publication_date:" + desde + "-01-01");
  const url =
    "https://api.openalex.org/works" +
    "?search=" + encodeURIComponent(query) +
    "&filter=" + filtros.join(",") +
    "&per-page=" + MAX_RESULTS +
    "&select=id,title,authorships,publication_year,doi,cited_by_count,abstract_inverted_index,open_access,primary_location,type" +
    "&mailto=" + encodeURIComponent(MAILTO);

  const res = await fetch(url, { headers: { "User-Agent": "BibliotecaViva/1.0 (mailto:" + MAILTO + ")" } });
  if (!res.ok) throw new Error("openalex_error");
  const data = await res.json();
  const works = Array.isArray(data.results) ? data.results : [];

  return works
    .filter((w) => w && w.title)
    .map((w) => {
      const oa = w.open_access || {};
      const loc = w.primary_location || {};
      const source = loc.source || {};
      const doi = w.doi || "";
      const url =
        (oa.is_oa && oa.oa_url) ||
        doi ||
        loc.landing_page_url ||
        w.id ||
        "";
      const nombres = listaAutoresOpenAlex(w.authorships);
      return {
        titulo: s(w.title),
        autores: autoresParaMostrar(nombres),
        autores_lista: nombres,
        anio: w.publication_year || "",
        revista: s(source.display_name),
        doi: doi,
        url: url,
        oa: !!oa.is_oa,
        citas: typeof w.cited_by_count === "number" ? w.cited_by_count : null,
        tipo_doc: tipoDoc(w.type),
        resumen: truncar(reconstructAbstract(w.abstract_inverted_index), ABSTRACT_CHARS),
        fuente: "OpenAlex"
      };
    });
}

// ---- Europe PMC (gratis, sin llave; fuerte en química y biomedicina) ----
async function searchEuropePMC(query, opts) {
  const desde = (opts && opts.desdeAnio) || 0;
  const filtroAnio = desde ? " AND (PUB_YEAR:[" + desde + " TO 3000])" : "";
  const url =
    "https://www.ebi.ac.uk/europepmc/webservices/rest/search" +
    "?query=" + encodeURIComponent(query + " AND HAS_ABSTRACT:Y" + filtroAnio) +
    "&format=json&resultType=core&pageSize=" + MAX_RESULTS;

  const res = await fetch(url, { headers: { "User-Agent": "BibliotecaViva/1.0 (mailto:" + MAILTO + ")" } });
  if (!res.ok) throw new Error("epmc_error");
  const data = await res.json();
  const works =
    data && data.resultList && Array.isArray(data.resultList.result)
      ? data.resultList.result
      : [];

  return works
    .filter((w) => w && w.title)
    .map((w) => {
      const doiBare = s(w.doi);
      const doiUrl = doiBare ? "https://doi.org/" + doiBare : "";
      const link =
        doiUrl ||
        (w.id && w.source ? "https://europepmc.org/article/" + w.source + "/" + w.id : "");
      const pts =
        w.pubTypeList && Array.isArray(w.pubTypeList.pubType) ? w.pubTypeList.pubType : [];
      const tipo = pts.some((t) => /review/i.test(s(t))) ? "Revisión" : "Artículo";
      // Europe PMC trae authorList estructurado en resultType=core. Se prefiere sobre
      // authorString, que es una sola cadena separada por comas y por tanto ambigua.
      const autoresEp =
        (w.authorList && Array.isArray(w.authorList.author) ? w.authorList.author : [])
          .map((a) => {
            if (!a) return "";
            const ap = s(a.lastName).trim();
            const nom = s(a.firstName).trim() || s(a.initials).trim();
            if (ap && nom) return ap + ", " + nom;
            return ap || s(a.fullName).trim();
          })
          .filter(Boolean);
      return {
        titulo: s(w.title),
        autores: autoresEp.length ? autoresParaMostrar(autoresEp) : truncar(s(w.authorString), 120),
        autores_lista: autoresEp,
        anio: w.pubYear || "",
        revista: s(w.journalTitle),
        doi: doiUrl,
        url: link,
        oa: s(w.isOpenAccess) === "Y",
        citas: typeof w.citedByCount === "number" ? w.citedByCount : null,
        tipo_doc: tipo,
        resumen: truncar(s(w.abstractText), ABSTRACT_CHARS),
        fuente: "Europe PMC"
      };
    });
}

// ---- Crossref (gratis, sin llave) ----
// Aporta lo que las otras dos rankean distinto o no traen: en la medición del 2026-07-24,
// 7 de 8 resultados eran nuevos frente a OpenAlex + Europe PMC, incluyendo literatura en
// español que las otras dos no devolvieron (relevante para el ángulo regional del lab).
// Los filtros no son opcionales: sin has-abstract:true devuelve registros sin resumen y
// sin type:journal-article devuelve piezas que no son artículos (pies de tabla, por
// ejemplo). Como la MDE y la síntesis dependen del campo "resumen", un registro sin
// abstract entraría mudo al análisis.
function limpiarHtml(v) {
  return s(v).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function listaAutoresCrossref(autores) {
  if (!Array.isArray(autores)) return [];
  return autores
    .map((a) => {
      if (!a) return "";
      const fam = s(a.family).trim();
      const dado = s(a.given).trim();
      if (fam && dado) return fam + ", " + dado;
      return fam || dado || s(a.name).trim();
    })
    .filter(Boolean);
}

async function searchCrossref(query, opts) {
  const desde = (opts && opts.desdeAnio) || 0;
  const filtros = ["has-abstract:true", "type:journal-article"];
  if (desde) filtros.push("from-pub-date:" + desde + "-01-01");
  const url =
    "https://api.crossref.org/works" +
    "?query.bibliographic=" + encodeURIComponent(query) +
    "&filter=" + filtros.join(",") +
    "&rows=" + MAX_RESULTS +
    "&select=title,author,issued,DOI,abstract,container-title,type,is-referenced-by-count" +
    "&mailto=" + encodeURIComponent(MAILTO);

  const res = await fetch(url, { headers: { "User-Agent": "BibliotecaViva/1.0 (mailto:" + MAILTO + ")" } });
  if (!res.ok) throw new Error("crossref_error");
  const data = await res.json();
  const works = (data && data.message && Array.isArray(data.message.items)) ? data.message.items : [];

  return works
    .map((w) => {
      const titulo = limpiarHtml((w.title || [])[0]);
      const doiBare = s(w.DOI);
      const partes = (w.issued && Array.isArray(w.issued["date-parts"]) && w.issued["date-parts"][0]) || [];
      // Crossref suele prefijar el abstract con la palabra "Abstract" dentro del XML.
      const resumen = limpiarHtml(w.abstract).replace(/^Abstract[:\s]*/i, "");
      const nombres = listaAutoresCrossref(w.author);
      return {
        titulo: titulo,
        autores: autoresParaMostrar(nombres),
        autores_lista: nombres,
        anio: partes[0] || "",
        revista: limpiarHtml((w["container-title"] || [])[0]),
        doi: doiBare ? "https://doi.org/" + doiBare : "",
        url: doiBare ? "https://doi.org/" + doiBare : "",
        // Crossref no informa estado de acceso abierto en esta consulta. Se deja en null
        // ("no se sabe") a proposito: marcarlo false diria "acceso cerrado" al usuario,
        // que seria una afirmacion que no podemos sostener. El frontend solo pinta el chip
        // cuando oa es true o false explicito.
        oa: null,
        citas: typeof w["is-referenced-by-count"] === "number" ? w["is-referenced-by-count"] : null,
        tipo_doc: "Artículo",
        resumen: truncar(resumen, ABSTRACT_CHARS),
        fuente: "Crossref"
      };
    })
    .filter((r) => r.titulo && r.resumen);
}

// Busca en las tres bases en paralelo y devuelve la union deduplicada, mas el conteo por
// base (para el registro de busqueda). Solo falla (para que el handler responda error) si
// TODAS las fuentes caen: una base caida nunca debe tumbar la busqueda entera.
async function buscarCombinado(query, opts) {
  const fuentes = [
    ["OpenAlex", searchOpenAlex],
    ["Europe PMC", searchEuropePMC],
    ["Crossref", searchCrossref]
  ];
  const listas = await Promise.all(
    fuentes.map(([, fn]) => fn(query, opts).catch(() => null))
  );
  if (listas.every((l) => l === null)) throw new Error("openalex_error");

  const porBase = {};
  fuentes.forEach(([nombre], i) => {
    // null = la base fallo o no respondio; 0 = respondio sin resultados. Se distinguen
    // porque en el registro de busqueda no es lo mismo "no habia nada" que "se cayo".
    porBase[nombre] = listas[i] === null ? null : listas[i].length;
  });

  return { items: dedup(interleave(listas.map((l) => l || []))), porBase };
}

// ---- Esquemas ----
const QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["query"],
  properties: { query: { type: "string" } }
};
const APORTES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["aportes"],
  properties: {
    aportes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["indice", "aporte", "fuerza"],
        properties: {
          indice: { type: "integer" },
          aporte: { type: "string" },
          // Que tan directamente el articulo sostiene el componente indicado.
          fuerza: { type: "string", enum: ["alta", "media", "baja"] }
        }
      }
    }
  }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Metodo no permitido" });
    return;
  }
  // Contencion antes que cualquier otra cosa. Ver web/lib/contencion.js.
  if (!aplicarContencion(req, res)) return;

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "El servidor no tiene configurada la clave de la API." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { res.status(400).json({ error: "Cuerpo invalido" }); return; }
  }
  if (tamanoExcedido(body, MAX_BODY_CHARS)) {
    res.status(413).json({ error: "Los datos enviados son demasiado grandes." });
    return;
  }
  const perspectiva = s(body && body.perspectiva);
  const queNecesito = s(body && body.que_necesito);
  const ctx = (body && body.contexto) || {};
  // Consulta escrita por el investigador. Si viene, se usa TAL CUAL y no se llama al
  // modelo: es lo que hace la busqueda reproducible (misma consulta, misma busqueda).
  const queryManual = s(body && body.query).trim().slice(0, 300);
  // Filtros opcionales. Se sanean aqui, nunca se concatenan crudos a una URL.
  const desdeAnioRaw = parseInt(body && body.desde_anio, 10);
  const desdeAnio = Number.isInteger(desdeAnioRaw) && desdeAnioRaw >= 1800 && desdeAnioRaw <= 2100
    ? desdeAnioRaw
    : 0;
  const tipoFiltro = ["revision", "primario"].includes(s(body && body.tipo)) ? s(body.tipo) : "";

  if (!perspectiva) {
    res.status(400).json({ error: "Falta la perspectiva" });
    return;
  }
  if (!s(ctx.tema)) {
    res.status(400).json({ error: "Falta el tema de la investigacion." });
    return;
  }

  try {
    const opts = { desdeAnio: desdeAnio };

    // 1) Consulta academica en ingles. Se omite si el investigador escribio la suya.
    let query;
    let queryOrigen;
    if (queryManual) {
      query = queryManual;
      queryOrigen = "manual";
    } else {
      const querySystem =
        "Eres un asistente de investigacion bibliometrica. Conviertes el contexto de una investigacion y una perspectiva especifica en UNA consulta de busqueda academica efectiva, EN INGLES (la mayoria de la literatura cientifica esta en ingles). Usa terminos y nombres cientificos correctos (por ejemplo, nombres binomiales de especies en vez de nombres comunes). Devuelve solo la consulta, de 3 a 8 palabras clave, sin operadores booleanos.";
      const queryUser =
        `Tema: ${s(ctx.tema)}\n` +
        `Abstract o descripcion: ${s(ctx.abstract)}\n` +
        `Problema: ${s(ctx.problema)}\n` +
        `Pregunta principal: ${s(ctx.pregunta_principal)}\n` +
        `Perspectiva: ${perspectiva}\n` +
        `Que necesita cubrir esta perspectiva: ${queNecesito}\n\n` +
        "Genera la consulta de busqueda en ingles para encontrar articulos que apoyen esta perspectiva.";
      const q = await callClaude(querySystem, queryUser, QUERY_SCHEMA);
      query = s(q && q.query) || s(ctx.tema);
      queryOrigen = "ia";
    }

    // 2) Busqueda real en OpenAlex + Europe PMC + Crossref (combinadas y deduplicadas).
    const combinado = await buscarCombinado(query, opts);
    let resultados = combinado.items;
    const porBase = combinado.porBase;
    let queryAmpliada = "";

    // Reintento con una consulta mas amplia si salio poco o nada. NO se hace cuando la
    // consulta la escribio el investigador: si pidio esa consulta exacta, ampliarla en
    // silencio devolveria resultados que su consulta no pidio y romperia justo la
    // reproducibilidad que el modo manual existe para dar.
    if (resultados.length < 3 && queryOrigen === "ia") {
      const amplia = query.split(/\s+/).slice(0, 3).join(" ");
      if (amplia && amplia.toLowerCase() !== query.toLowerCase()) {
        try {
          const extra = await buscarCombinado(amplia, opts);
          resultados = dedup(resultados.concat(extra.items));
          queryAmpliada = amplia;
        } catch {
          // Si el reintento falla, conservamos lo que ya teniamos.
        }
      }
    }

    // Filtro por tipo de documento. Se aplica despues de combinar porque cada base
    // clasifica los tipos distinto; se usa la etiqueta ya normalizada en tipo_doc.
    const totalAntesDeFiltro = resultados.length;
    if (tipoFiltro === "revision") {
      resultados = resultados.filter((r) => r.tipo_doc === "Revisión");
    } else if (tipoFiltro === "primario") {
      resultados = resultados.filter((r) => r.tipo_doc !== "Revisión");
    }

    // Limitar al tope para la anotacion, conservando el intercalado por fuente.
    const totalEncontrado = resultados.length;
    resultados = resultados.slice(0, MAX_RESULTS);

    // Metadatos del registro de busqueda: lo que hace la busqueda auditable despues.
    const meta = {
      query: query,
      query_origen: queryOrigen,
      query_ampliada: queryAmpliada,
      por_base: porBase,
      filtros: { desde_anio: desdeAnio || null, tipo: tipoFiltro || null },
      total_encontrado: totalEncontrado,
      descartados_por_tipo: tipoFiltro ? totalAntesDeFiltro - totalEncontrado : 0
    };

    if (resultados.length === 0) {
      res.status(200).json({ resultados: [], ...meta });
      return;
    }

    // 3) Anotar cada articulo con su aporte a la investigacion
    const aporteSystem =
      "Eres un asistente bibliometrico que ayuda a un investigador a ver como cada articulo real apoya su trabajo. Para cada articulo devuelves dos cosas: 'aporte', en 1 o 2 oraciones en espanol, que explica su contribucion concreta al componente indicado y a la pregunta de investigacion; y 'fuerza', que clasifica que tan directamente lo sostiene, en uno de: 'alta' (evidencia directa y central para ese componente), 'media' (relevante pero parcial o indirecta), 'baja' (tangencial). Basate solo en el titulo y el resumen. Se honesto: si el articulo es tangencial, dilo y clasifica fuerza baja. No inventes datos que no esten en el titulo o el resumen.";
    const lista = resultados
      .map((r, idx) => `#${idx}\nTitulo: ${r.titulo}\nResumen: ${truncar(r.resumen, 500)}`)
      .join("\n\n");
    const aporteUser =
      `Investigacion. Tema: ${s(ctx.tema)}. Pregunta principal: ${s(ctx.pregunta_principal)}.\n` +
      `Perspectiva a apoyar: ${perspectiva} (${queNecesito}).\n\n` +
      `Articulos encontrados:\n${lista}\n\n` +
      "Para cada articulo (por su indice), redacta el campo aporte.";
    try {
      // Margen de salida acorde al tope de resultados: con 12 articulos la respuesta
      // ronda los 1300 tokens, demasiado cerca del default de 1600. Este proyecto ya
      // tuvo dos bugs de truncamiento por quedarse corto aqui, ver docs/current-status.md.
      const anot = await callClaude(aporteSystem, aporteUser, APORTES_SCHEMA, 2800);
      const mapa = {};
      if (anot && Array.isArray(anot.aportes)) {
        for (const a of anot.aportes) {
          if (a && Number.isInteger(a.indice)) {
            mapa[a.indice] = { aporte: s(a.aporte), fuerza: s(a.fuerza) };
          }
        }
      }
      resultados = resultados.map((r, idx) => ({
        ...r,
        aporte: (mapa[idx] && mapa[idx].aporte) || "",
        fuerza: (mapa[idx] && mapa[idx].fuerza) || ""
      }));
    } catch {
      // Si falla la anotacion, devolvemos igual los articulos reales sin aporte.
      resultados = resultados.map((r) => ({ ...r, aporte: "", fuerza: "" }));
    }

    res.status(200).json({ resultados, ...meta });
  } catch (e) {
    console.error("Fallo en la busqueda:", e);
    if (e.message === "openalex_error") {
      res.status(502).json({ error: "No se pudo consultar ninguna base de datos de articulos. Intenta de nuevo." });
    } else if (e.message === "claude_truncated") {
      res.status(502).json({ error: "La respuesta del agente quedo incompleta. Intenta de nuevo." });
    } else {
      res.status(500).json({ error: "Error interno al buscar articulos." });
    }
  }
}
