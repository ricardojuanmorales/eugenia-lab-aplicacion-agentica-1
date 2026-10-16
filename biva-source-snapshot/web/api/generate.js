// Función serverless (Vercel) que actúa de proxy seguro hacia la API de Claude.
// La clave ANTHROPIC_API_KEY vive solo en el servidor, nunca llega al navegador.
// El navegador solo puede pedir una de las tareas definidas abajo, con datos
// estructurados: así la clave no queda expuesta como un "Claude gratis" para
// cualquiera que escanee el QR.

import { aplicarContencion, tamanoExcedido } from "../lib/contencion.js";

// Modelo configurable por variable de entorno. Por defecto Claude Sonnet 5:
// buen balance de calidad, costo y latencia para una app pública en el teléfono.
// Para máxima calidad, pon CLAUDE_MODEL=claude-opus-5 en Vercel. Antes esta nota decia
// claude-opus-4-8; quedo desactualizada, Opus 5 cuesta lo mismo y es mejor. El analisis
// de costo por tarea esta en lab/decision_log.md (2026-07-25), discutido y sin decidir.
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

// Tope de tamano del payload que el navegador puede enviar.
//
// Historia, porque el numero se movio dos veces en dos dias: era 40000; subio a 150000 el
// 2026-07-24, cuando search.js paso a conservar 2500 caracteres de abstract en vez de 900,
// porque con 15 referencias el payload de la MDE rondaba los 42000 y el tope viejo lo
// habria rechazado con un 413 justo al investigador que mas evidencia curo.
//
// Bajado a 80000 el 2026-07-25 como parte de la contencion de costo. 150000 era holgura
// muy por encima de lo necesario, y toda esa holgura es texto que controla quien llama al
// endpoint: es el amplificador que abarata montar un abuso. Con 80000 siguen cabiendo unas
// 28 referencias con abstract completo, casi el doble del caso real mas cargado que se ha
// medido. Ver docs/decisions.md (2026-07-25).
const MAX_PAYLOAD_CHARS = 80000;

function s(v) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

// ---- Esquemas de salida (Structured Outputs) ----
// Garantizan JSON válido sin tener que limpiar bloques markdown a mano.
const SCHEMAS = {
  friccion: {
    type: "object",
    additionalProperties: false,
    required: ["opciones"],
    properties: {
      opciones: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["titulo", "descripcion"],
          properties: {
            titulo: { type: "string" },
            descripcion: { type: "string" }
          }
        }
      }
    }
  },
  pregunta: {
    type: "object",
    additionalProperties: false,
    required: [
      "problema",
      "pregunta_principal",
      "preguntas_secundarias",
      "objetivo_general",
      "objetivos_especificos",
      "delimitaciones"
    ],
    properties: {
      problema: { type: "string" },
      pregunta_principal: { type: "string" },
      preguntas_secundarias: { type: "array", items: { type: "string" } },
      objetivo_general: { type: "string" },
      objetivos_especificos: { type: "array", items: { type: "string" } },
      delimitaciones: { type: "string" }
    }
  },
  mapa: {
    type: "object",
    additionalProperties: false,
    required: ["perspectivas"],
    properties: {
      perspectivas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["perspectiva", "que_necesito"],
          properties: {
            perspectiva: { type: "string" },
            que_necesito: { type: "string" }
          }
        }
      }
    }
  },
  divulgacion: {
    type: "object",
    additionalProperties: false,
    required: ["estructura"],
    properties: {
      estructura: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["seccion", "contenido_breve"],
          properties: {
            seccion: { type: "string" },
            contenido_breve: { type: "string" }
          }
        }
      }
    }
  },
  notas: {
    type: "object",
    additionalProperties: false,
    required: ["idea_principal", "conceptos_clave", "relacion_investigacion"],
    properties: {
      idea_principal: { type: "string" },
      conceptos_clave: { type: "array", items: { type: "string" } },
      relacion_investigacion: { type: "string" }
    }
  },
  reenfoque: {
    type: "object",
    additionalProperties: false,
    required: [
      "tema",
      "problema",
      "pregunta_principal",
      "objetivo_general",
      "objetivos_especificos",
      "justificacion_giro",
      "fuentes"
    ],
    properties: {
      tema: { type: "string" },
      problema: { type: "string" },
      pregunta_principal: { type: "string" },
      objetivo_general: { type: "string" },
      objetivos_especificos: { type: "array", items: { type: "string" } },
      justificacion_giro: { type: "string" },
      // Numeros (1-based) de las referencias aceptadas que sostienen el nuevo foco.
      fuentes: { type: "array", items: { type: "integer" } }
    }
  },
  mde: {
    type: "object",
    additionalProperties: false,
    required: ["dimensiones"],
    properties: {
      dimensiones: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["dimension", "hallazgo_evidencia", "criterio_adoptado", "fuentes"],
          properties: {
            dimension: { type: "string" },
            hallazgo_evidencia: { type: "string" },
            criterio_adoptado: { type: "string" },
            // Numeros (1-based) de las referencias aceptadas que sostienen esta fila.
            fuentes: { type: "array", items: { type: "integer" } }
          }
        }
      }
    }
  },
  sintesis: {
    type: "object",
    additionalProperties: false,
    required: ["hallazgos"],
    properties: {
      hallazgos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["tipo", "hallazgo", "implicacion", "fuentes", "confianza"],
          properties: {
            tipo: { type: "string", enum: ["consenso", "contradiccion", "brecha"] },
            hallazgo: { type: "string" },
            implicacion: { type: "string" },
            fuentes: { type: "array", items: { type: "integer" } },
            confianza: { type: "string", enum: ["alta", "media", "baja"] }
          }
        }
      }
    }
  },
  extraerReferencia: {
    type: "object",
    additionalProperties: false,
    required: ["titulo", "autores", "anio", "resumen"],
    properties: {
      titulo: { type: "string" },
      autores: { type: "string" },
      anio: { type: "string" },
      resumen: { type: "string" }
    }
  },
  borradores: {
    type: "object",
    additionalProperties: false,
    required: ["justificacion", "metodos", "comparacion", "discusion", "tabla_comparativa"],
    properties: {
      // Cuatro borradores de parrafo, uno por componente del trabajo. Cada uno
      // cita sus fuentes con marcadores [n] que remiten a las referencias
      // aceptadas numeradas.
      justificacion: { type: "string" },
      metodos: { type: "string" },
      comparacion: { type: "string" },
      discusion: { type: "string" },
      tabla_comparativa: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fuente", "enfoque", "hallazgo_principal", "limitacion"],
          properties: {
            // Numero (1-based) de la referencia aceptada que resume esta fila.
            fuente: { type: "integer" },
            enfoque: { type: "string" },
            hallazgo_principal: { type: "string" },
            limitacion: { type: "string" }
          }
        }
      }
    }
  },
  auditoria: {
    type: "object",
    additionalProperties: false,
    required: ["cobertura", "senales"],
    properties: {
      // Una entrada por cada una de las 6 dimensiones, siempre (verificado en el
      // cliente, no se puede forzar "exactamente 6" via minItems en este schema:
      // la API solo acepta minItems/maxItems de 0 o 1 en arrays).
      cobertura: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["dimension", "estado", "nota"],
          properties: {
            dimension: {
              type: "string",
              enum: ["teorica", "metodologica", "etica", "novedad", "reproducibilidad", "alineacion_pregunta_evidencia"]
            },
            estado: { type: "string", enum: ["senales_encontradas", "sin_evidencia_suficiente"] },
            nota: { type: "string" }
          }
        }
      },
      // Sin cuota minima ni maxima: puede haber cero senales en total.
      senales: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["dimension", "senal", "por_que_importa", "ancla_tipo", "ancla_detalle", "fuentes", "severidad"],
          properties: {
            dimension: {
              type: "string",
              enum: ["teorica", "metodologica", "etica", "novedad", "reproducibilidad", "alineacion_pregunta_evidencia"]
            },
            senal: { type: "string" },
            por_que_importa: { type: "string" },
            ancla_tipo: {
              type: "string",
              enum: ["fuente_bibliografica", "ausencia_en_corpus", "resultado_propio", "diseno_propio"]
            },
            ancla_detalle: { type: "string" },
            // Numeros (1-based) de referencias aceptadas; vacio si el ancla es un resultado propio.
            fuentes: { type: "array", items: { type: "integer" } },
            severidad: { type: "string", enum: ["alta", "media", "baja"] }
          }
        }
      }
    }
  }
};

// ---- Constructores de prompt por tarea ----
// Devuelven { system, user } y un "unwrap" para dar al cliente la forma que espera.
function buildFriccion(p) {
  const idea = p.idea || {};
  const system =
    "Eres un asistente de investigacion que ayuda a estudiantes universitarios a identificar fricciones conceptuales (tensiones que justifican investigar algo). Respondes unicamente con datos estructurados.";
  const user =
    `Tema: ${s(idea.tema)}\n` +
    `Por que le interesa: ${s(idea.porque)}\n` +
    `Que cree que ya sabe: ${s(idea.yaSe)}\n` +
    `Que no entiende todavia: ${s(idea.noEntiendo)}\n` +
    `Intuicion de tension: ${s(idea.tension)}\n\n` +
    "Genera exactamente 4 opciones. Cada titulo debe ser corto (menos de 8 palabras) y cada descripcion debe explicar en 1 a 2 oraciones una tension conceptual real y especifica a este tema (por ejemplo: una creencia popular versus evidencia cientifica, una practica comun versus sus riesgos, una explicacion aceptada versus casos que no encajan).";
  return { system, user, schemaKey: "friccion", unwrap: (r) => r.opciones };
}

function buildPregunta(p) {
  const system =
    "Eres un asistente de investigacion que ayuda a estudiantes a formular problemas investigables. Respondes unicamente con datos estructurados.";
  const user =
    `Idea inicial: ${JSON.stringify(p.idea || {})}\n` +
    `Friccion conceptual elegida: ${s(p.friccionSeleccion)}\n\n` +
    "Genera un problema investigable, una pregunta principal, dos preguntas secundarias, un objetivo general, dos objetivos especificos y las delimitaciones. Todo en espanol, especifico al tema, breve y claro.";
  return { system, user, schemaKey: "pregunta", unwrap: (r) => r };
}

function buildMapa(p) {
  const idea = p.idea || {};
  const preg = p.pregunta || {};
  const system =
    "Eres un asistente de investigacion. Respondes unicamente con datos estructurados.";
  const user =
    `Tema: ${s(idea.tema)}\n` +
    `Problema: ${s(preg.problema)}\n` +
    `Pregunta principal: ${s(preg.pregunta_principal)}\n\n` +
    "Genera exactamente 4 componentes de un trabajo publicable, con estos nombres exactos en este orden: " +
    "'Justificacion y brecha', 'Metodos', 'Comparacion de resultados', 'Discusion y contraste'. " +
    "Para cada componente, que_necesito es una frase especifica de 1 a 2 oraciones sobre que evidencia bibliografica necesita esa seccion PARA ESTE TEMA en particular (por ejemplo, en Metodos: que enfoques metodologicos conviene revisar para elegir y defender el propio), no una definicion generica.";
  return { system, user, schemaKey: "mapa", unwrap: (r) => r.perspectivas, maxTokens: 2200 };
}

function buildDivulgacion(p) {
  const idea = p.idea || {};
  const preg = p.pregunta || {};
  const refs = Array.isArray(p.referencias) ? p.referencias.map(s).join("; ") : "";
  const system =
    "Eres un asistente de divulgacion cientifica. Respondes unicamente con datos estructurados.";
  const user =
    `Formato elegido: ${s(p.formato)}\n` +
    `Tema: ${s(idea.tema)}\n` +
    `Problema: ${s(preg.problema)}\n` +
    `Pregunta principal: ${s(preg.pregunta_principal)}\n` +
    `Objetivo general: ${s(preg.objetivo_general)}\n` +
    `Referencias aceptadas: ${refs}\n\n` +
    "Genera entre 5 y 8 secciones apropiadas para el formato elegido, en espanol, especificas a este proyecto. Cada seccion con un titulo y una descripcion breve de su contenido.";
  return { system, user, schemaKey: "divulgacion", unwrap: (r) => r, maxTokens: 2200 };
}

function buildNotas(p) {
  const ref = p.referencia || {};
  const idea = p.idea || {};
  const preg = p.pregunta || {};
  const system =
    "Eres un asistente de investigacion que ayuda a estudiantes a redactar un borrador de ficha de lectura a partir de una referencia real. Tu resultado es un punto de partida que el estudiante debe revisar y editar con criterio propio, no una conclusion final. Respondes unicamente con datos estructurados.";
  const user =
    `Tema del proyecto: ${s(idea.tema)}\n` +
    `Pregunta principal del proyecto: ${s(preg.pregunta_principal)}\n\n` +
    `Referencia: ${s(ref.titulo)} (${s(ref.autores)}, ${s(ref.anio)})\n` +
    `Resumen/abstract real de la referencia: ${s(ref.resumen)}\n` +
    `Aporte ya identificado en la busqueda: ${s(ref.justificacion)}\n\n` +
    "A partir del resumen real (no inventes datos que no esten ahi), redacta: la idea principal del articulo en 1 a 2 oraciones, entre 3 y 5 conceptos clave breves, y como se relaciona especificamente con el tema y la pregunta de este proyecto en 1 a 2 oraciones.";
  return { system, user, schemaKey: "notas", unwrap: (r) => r };
}

function buildMde(p) {
  const idea = p.idea || {};
  const preg = p.pregunta || {};
  const refs = Array.isArray(p.referencias) ? p.referencias : [];
  const lista = refs
    .map((r, i) => {
      const n = i + 1;
      return (
        `[${n}] ${s(r.titulo)} (${s(r.autores)}, ${s(r.anio)})\n` +
        `    Resumen: ${s(r.resumen)}\n` +
        `    Aporte identificado: ${s(r.justificacion)}`
      );
    })
    .join("\n");
  const system =
    "Eres un asistente de investigacion que construye una Matriz de Decision: traduce evidencia bibliografica ya curada en criterios operativos concretos para tomar decisiones dentro de una investigacion. Te adaptas a cualquier disciplina: las dimensiones de decision dependen del campo del trabajo (por ejemplo, en quimica podrian ser solvente, metodo de extraccion o rangos de un parametro; en otros campos seran otras). Usas unicamente la evidencia de las fuentes provistas, nunca inventas datos ni citas. Respondes unicamente con datos estructurados.";
  const user =
    `Tema del proyecto: ${s(idea.tema)}\n` +
    `Pregunta principal: ${s(preg.pregunta_principal)}\n` +
    `Objetivo general: ${s(preg.objetivo_general)}\n\n` +
    `Referencias aceptadas (numeradas):\n${lista}\n\n` +
    "A partir SOLO de estas referencias, identifica entre 3 y 6 dimensiones de decision relevantes para ESTE trabajo en particular (las que el investigador debe resolver para avanzar). Para cada dimension: 'hallazgo_evidencia' resume que dice la evidencia curada al respecto; 'criterio_adoptado' es una decision operativa concreta y accionable que se recomienda tomar, coherente con esa evidencia; 'fuentes' es la lista de numeros de las referencias que sostienen esa fila (solo numeros que aparezcan en la lista de arriba). No inventes dimensiones que las fuentes no puedan sostener. Todo en espanol, especifico a este proyecto.";
  return { system, user, schemaKey: "mde", unwrap: (r) => r.dimensiones, maxTokens: 2400 };
}

function buildSintesis(p) {
  const idea = p.idea || {};
  const preg = p.pregunta || {};
  const refs = Array.isArray(p.referencias) ? p.referencias : [];
  const lista = refs
    .map((r, i) =>
      `[${i + 1}] ${s(r.titulo)} (${s(r.autores)}, ${s(r.anio)})\n` +
      `    Resumen: ${s(r.resumen)}\n` +
      `    Aporte identificado: ${s(r.justificacion)}`
    )
    .join("\n");
  const system =
    "Eres un analista de evidencia cientifica. Comparas articulos ya seleccionados para identificar convergencias, contradicciones y brechas relevantes para una investigacion. Trabajas solo con los titulos, resumenes y aportes provistos. No conviertes ausencia de informacion en prueba de ausencia, no inventas resultados y distingues claramente una brecha del corpus provisto de una brecha demostrada de toda la literatura. Respondes unicamente con datos estructurados.";
  const user =
    `Tema: ${s(idea.tema)}\n` +
    `Pregunta principal: ${s(preg.pregunta_principal)}\n` +
    `Objetivo general: ${s(preg.objetivo_general)}\n\n` +
    `Fuentes aceptadas (numeradas):\n${lista}\n\n` +
    "Genera entre 3 y 7 hallazgos utiles. Usa tipo 'consenso' cuando dos o mas fuentes converjan; 'contradiccion' cuando reporten resultados, metodos o interpretaciones incompatibles; y 'brecha' para algo relevante que este corpus no resuelve. Para cada hallazgo explica su implicacion concreta para este proyecto, asigna solamente los numeros de las fuentes que realmente lo sostienen y declara confianza alta, media o baja segun la claridad y cantidad de evidencia disponible. Si no hay evidencia suficiente para una contradiccion, no la inventes. En las brechas, redacta explicitamente que se trata de una brecha observada en el corpus seleccionado.";
  return { system, user, schemaKey: "sintesis", unwrap: (r) => r.hallazgos, maxTokens: 2600 };
}

function buildReenfoque(p) {
  const idea = p.idea || {};
  const preg = p.pregunta || {};
  const refs = Array.isArray(p.referencias) ? p.referencias : [];
  const lista = refs
    .map((r, i) => {
      const n = i + 1;
      return (
        `[${n}] ${s(r.titulo)} (${s(r.autores)}, ${s(r.anio)})\n` +
        `    Resumen: ${s(r.resumen)}\n` +
        `    Aporte: ${s(r.justificacion)}`
      );
    })
    .join("\n");
  const system =
    "Eres un asistente de investigacion. Ayudas a un investigador a reconsiderar el foco de su trabajo a la luz de los articulos que realmente selecciono, no de los que penso al principio. Es legitimo que el foco se reoriente hacia los intereses que emergen de esa seleccion, aunque cambie respecto al foco original: a veces la verdadera pregunta se descubre leyendo. Basas la propuesta unicamente en los articulos provistos, nunca inventas datos ni citas. Respondes unicamente con datos estructurados.";
  const user =
    `Foco original. Tema: ${s(idea.tema)}. Pregunta principal: ${s(preg.pregunta_principal)}.\n\n` +
    `Articulos que el investigador acepto (numerados):\n${lista}\n\n` +
    "Propon un foco de investigacion reformulado que emerja genuinamente de estos articulos seleccionados, aunque implique un giro respecto al foco original. Devuelve: 'tema' (el nuevo angulo, breve), 'problema', 'pregunta_principal', 'objetivo_general', entre 2 y 3 'objetivos_especificos', 'justificacion_giro' (en 2 a 3 oraciones, como este nuevo foco surge de los articulos elegidos y en que se diferencia del foco original), y 'fuentes' (los numeros de los articulos que sostienen el nuevo foco). Todo en espanol, especifico y coherente con la evidencia seleccionada.";
  return { system, user, schemaKey: "reenfoque", unwrap: (r) => r, maxTokens: 2000 };
}

function buildExtraerReferencia(p) {
  const texto = s(p.texto).slice(0, 8000);
  const system =
    "Eres un asistente bibliografico que identifica los datos de una referencia a partir del texto extraido de las primeras paginas de un PDF real que el investigador ya tiene en su poder (por ejemplo, un articulo de una base de datos paga a la que tiene acceso institucional). Trabajas UNICAMENTE con el texto provisto, nunca inventas ni completas con conocimiento externo. Si no puedes identificar con confianza el titulo, los autores o el anio, deja ese campo como cadena vacia en vez de adivinar. El resumen sintetiza en 2 a 4 oraciones, en espanol, el contenido real del articulo segun el texto provisto (si el texto incluye un abstract, basate en el; si no, sintetiza a partir de la introduccion disponible, sin inventar resultados que no esten en el texto). Respondes unicamente con datos estructurados.";
  const user =
    `Texto extraido de las primeras paginas de un PDF:\n\n${texto}\n\n` +
    "Identifica titulo, autores (en el formato en que aparezcan, separados por coma), anio de publicacion, y redacta el resumen.";
  return { system, user, schemaKey: "extraerReferencia", unwrap: (r) => r, maxTokens: 700 };
}

// Convierte la evidencia ya curada (referencias aceptadas, sintesis y MDE) en
// borradores de seccion listos para adaptar a un manuscrito, mas una tabla
// comparativa de fuentes. Cada afirmacion se ancla a las fuentes reales por [n];
// nunca inventa resultados ni citas (mismo principio que mde y sintesis).
function buildBorradores(p) {
  const idea = p.idea || {};
  const preg = p.pregunta || {};
  const refs = Array.isArray(p.referencias) ? p.referencias : [];
  const lista = refs
    .map((r, i) => {
      const n = i + 1;
      return (
        `[${n}] ${s(r.titulo)} (${s(r.autores)}, ${s(r.anio)})\n` +
        `    Resumen: ${s(r.resumen)}\n` +
        `    Aporte: ${s(r.justificacion)}`
      );
    })
    .join("\n");
  const sint = Array.isArray(p.sintesis) ? p.sintesis : [];
  const sintTxt = sint
    .map((h) => `- (${s(h.tipo)}) ${s(h.hallazgo)} [fuentes: ${(Array.isArray(h.fuentes) ? h.fuentes : []).join(", ")}]`)
    .join("\n");
  const mde = Array.isArray(p.mde) ? p.mde : [];
  const mdeTxt = mde.map((d) => `- ${s(d.dimension)}: ${s(d.criterio_adoptado)}`).join("\n");
  const system =
    "Eres un asistente de redaccion cientifica. Conviertes evidencia ya curada en borradores de secciones de un manuscrito. Cada afirmacion que dependa de la literatura debe citar, con marcadores del tipo [n], el numero de la o las fuentes que la sostienen, usando solo numeros que aparezcan en la lista provista. Nunca inventas resultados, cifras ni fuentes: si algo no esta sostenido por los resumenes provistos, no lo afirmas. Los borradores son un punto de partida que el investigador debe revisar y editar, no un texto final. Respondes unicamente con datos estructurados.";
  const user =
    `Tema: ${s(idea.tema)}\n` +
    `Pregunta principal: ${s(preg.pregunta_principal)}\n` +
    `Objetivo general: ${s(preg.objetivo_general)}\n\n` +
    `Referencias aceptadas (numeradas):\n${lista}\n\n` +
    (sintTxt ? `Sintesis de evidencia ya generada:\n${sintTxt}\n\n` : "") +
    (mdeTxt ? `Criterios de la Matriz de Decision ya adoptados:\n${mdeTxt}\n\n` : "") +
    "Redacta, en espanol y especifico a este proyecto, cuatro borradores de parrafo listos para adaptar a un manuscrito, uno por cada componente del trabajo: " +
    "'justificacion' (justificacion y brecha, para la introduccion), 'metodos' (que enfoques metodologicos sostiene la evidencia y como se justifica el propio), 'comparacion' (comparacion de resultados entre las fuentes) y 'discusion' (discusion y contraste: donde la literatura concuerda o discrepa y como se posiciona el aporte). " +
    "Cada parrafo debe citar sus fuentes con marcadores [n]. Usa los corchetes UNICAMENTE para citar numeros de fuentes (por ejemplo [1] o [2, 3]); nunca los uses para anotaciones, notas al editor ni comentarios como '[criterio adoptado]'. Ademas, genera 'tabla_comparativa' con una fila por cada fuente aceptada relevante: 'fuente' es su numero, 'enfoque' resume su metodo o angulo en pocas palabras, 'hallazgo_principal' su resultado central, y 'limitacion' su alcance o limitacion segun el resumen. No inventes contenido que las fuentes no puedan sostener; si un resumen no da informacion para una celda, se breve y honesto.";
  return { system, user, schemaKey: "borradores", unwrap: (r) => r, maxTokens: 3200 };
}

// Audita la defendibilidad del trabajo: identifica huecos teoricos, metodologicos,
// eticos, de novedad, de reproducibilidad y de alineacion pregunta-evidencia. Es la
// tarea de mayor riesgo de alucinacion de la app: cada senal debe anclarse a una
// fuente real, a una ausencia declarada del corpus, o a un elemento concreto de los
// resultados/diseno propio del investigador. Nunca a una intuicion del modelo.
// Ver docs/vision-app.md, seccion "Extension estrategica", para el principio completo.
function buildAuditoria(p) {
  const idea = p.idea || {};
  const preg = p.pregunta || {};
  const refs = Array.isArray(p.referencias) ? p.referencias : [];
  const lista = refs
    .map((r, i) => {
      const n = i + 1;
      return (
        `[${n}] ${s(r.titulo)} (${s(r.autores)}, ${s(r.anio)})\n` +
        `    Resumen: ${s(r.resumen)}\n` +
        `    Aporte identificado: ${s(r.justificacion)}`
      );
    })
    .join("\n");
  const sint = Array.isArray(p.sintesis) ? p.sintesis : [];
  const sintTxt = sint
    .map((h) => `- (${s(h.tipo)}) ${s(h.hallazgo)} [fuentes: ${(Array.isArray(h.fuentes) ? h.fuentes : []).join(", ")}]`)
    .join("\n");
  const mde = Array.isArray(p.mde) ? p.mde : [];
  const mdeTxt = mde.map((d) => `- ${s(d.dimension)}: ${s(d.criterio_adoptado)}`).join("\n");
  const propios = Array.isArray(p.resultadosPropios) ? p.resultadosPropios : [];
  const propiosTxt = propios
    .map((r, i) => {
      const n = i + 1;
      return (
        `(R${n}) ${s(r.titulo)}\n` +
        `    Que midio: ${s(r.que_midio)}\n` +
        `    Metodo: ${s(r.metodo)}\n` +
        `    Muestra/alcance: ${s(r.muestra_alcance)}\n` +
        `    Hallazgo: ${s(r.hallazgo)}\n` +
        `    Limitaciones reconocidas por el investigador: ${s(r.limitaciones)}`
      );
    })
    .join("\n");

  const system =
    "Eres un auditor de defendibilidad de un trabajo de investigacion. Identificas posibles huecos que un revisor de una revista cientifica podria usar para atacar el trabajo: huecos teoricos, metodologicos, eticos, de novedad, de reproducibilidad, y de alineacion entre la pregunta de investigacion y la evidencia disponible. Esta es la tarea de mayor riesgo de alucinacion de toda la aplicacion: es facil generar criticas que suenan plausibles pero que no estan sostenidas por nada real, y tienes prohibido hacerlo. Cada senal que reportes debe anclarse, sin excepcion, a una de estas cuatro cosas: (1) una fuente bibliografica concreta de la lista provista, citada por su numero; (2) una ausencia declarada explicitamente en el corpus provisto; (3) un elemento especifico del diseno o metodo que el investigador declaro en sus resultados propios; o (4) un elemento especifico de los hallazgos que el investigador declaro en sus resultados propios. Nunca anclas una senal a una intuicion general, a tu conocimiento externo sobre el tema, ni a lo que suele pasar en investigaciones similares. Si una dimension no tiene una base real en lo que se te provee, no inventes una senal para llenarla: es obligatorio declarar esa dimension como sin_evidencia_suficiente con una nota breve de que le falta a la evidencia, en vez de fabricar una critica. No hay cuota minima ni maxima de senales por dimension: puede haber cero, una o varias, segun lo que la evidencia realmente sostenga; nunca fuerces senales en las 6 dimensiones solo para completar el formulario. Las senales de la dimension etica se formulan siempre como una pregunta abierta que el investigador deberia considerar, nunca como una acusacion o un veredicto de que algo esta mal. No uses guiones largos en ningun texto. Respondes unicamente con datos estructurados.";

  const user =
    `Tema: ${s(idea.tema)}\n` +
    `Pregunta principal: ${s(preg.pregunta_principal)}\n` +
    `Objetivo general: ${s(preg.objetivo_general)}\n\n` +
    `Fuentes aceptadas (numeradas; usa estos numeros en 'fuentes' cuando ancles una senal a literatura):\n${lista}\n\n` +
    (sintTxt ? `Sintesis de evidencia ya generada:\n${sintTxt}\n\n` : "") +
    (mdeTxt ? `Criterios de la Matriz de Decision ya adoptados:\n${mdeTxt}\n\n` : "") +
    (propiosTxt
      ? `Resultados propios declarados por el investigador (numerados R1, R2...; referencia este numero dentro de 'ancla_detalle' cuando ancles una senal a ellos, nunca en 'fuentes'):\n${propiosTxt}\n\n`
      : "El investigador no ha declarado resultados propios todavia. Sin ellos es normal y esperado que la dimension de reproducibilidad, y buena parte de la metodologica y la etica, queden como sin_evidencia_suficiente: no inventes un diseno o resultado propio que no se te dio.\n\n") +
    "Evalua estas 6 dimensiones, exactamente una entrada de 'cobertura' por cada una: 'teorica' (huecos o tensiones conceptuales que la literatura provista no resuelve), 'metodologica' (decisiones de metodo debiles o no justificadas por la evidencia), 'etica' (preguntas a considerar sobre consentimiento, manejo de datos, conflicto de interes u otro asunto etico, solo si hay una base concreta en lo provisto para plantearla), 'novedad' (que tan distinto es el aporte de lo que ya reporta el corpus aceptado), 'reproducibilidad' (que tan replicable es el diseno o metodo segun lo declarado, o que falta declarar), y 'alineacion_pregunta_evidencia' (donde la pregunta principal se desvia de lo que la evidencia curada y los resultados propios realmente sostienen). Para cada senal en 'senales': 'senal' describe el hueco concreto en 1 a 2 oraciones; 'por_que_importa' explica en 1 oracion por que un revisor podria atacar esto y como podria dificultar la publicacion; 'ancla_tipo' indica el tipo exacto de ancla; 'ancla_detalle' cita textual o casi textualmente el elemento concreto (el numero de fuente, la ausencia especifica, o el resultado propio referenciado por su numero R); 'fuentes' lista los numeros de fuentes bibliograficas involucradas (vacio si el ancla es un resultado propio o diseno propio); 'severidad' es alta, media o baja segun que tan probable es que un revisor la use para rechazar o pedir revision mayor. Todo en espanol, especifico a este proyecto, nunca generico.";

  return { system, user, schemaKey: "auditoria", unwrap: (r) => r, maxTokens: 5000 };
}

const BUILDERS = {
  friccion: buildFriccion,
  pregunta: buildPregunta,
  mapa: buildMapa,
  divulgacion: buildDivulgacion,
  notas: buildNotas,
  mde: buildMde,
  sintesis: buildSintesis,
  reenfoque: buildReenfoque,
  extraerReferencia: buildExtraerReferencia,
  borradores: buildBorradores,
  auditoria: buildAuditoria
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Metodo no permitido" });
    return;
  }
  // Contencion antes que cualquier otra cosa: no gastar ni un viaje de red, ni un token,
  // en una peticion que no viene de la app o que llega a un ritmo que ningun humano tiene.
  if (!aplicarContencion(req, res)) return;

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "El servidor no tiene configurada la clave de la API." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ error: "Cuerpo invalido" });
      return;
    }
  }
  const task = body && body.task;
  const payload = (body && body.payload) || {};

  const builder = BUILDERS[task];
  if (!builder) {
    res.status(400).json({ error: "Tarea no reconocida" });
    return;
  }
  if (tamanoExcedido(payload, MAX_PAYLOAD_CHARS)) {
    res.status(413).json({ error: "Los datos enviados son demasiado grandes." });
    return;
  }

  const { system, user, schemaKey, unwrap, maxTokens } = builder(payload);

  try {
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
        output_config: {
          format: { type: "json_schema", schema: SCHEMAS[schemaKey] }
        },
        messages: [{ role: "user", content: user }]
      })
    });

    const data = await apiRes.json();

    if (!apiRes.ok || data.type === "error") {
      console.error("Error de la API de Claude:", data);
      res.status(502).json({ error: "El agente no pudo responder en este momento." });
      return;
    }
    if (data.stop_reason === "refusal") {
      res.status(422).json({ error: "El agente declino responder a esta solicitud." });
      return;
    }
    if (data.stop_reason === "max_tokens") {
      console.error("Respuesta truncada por max_tokens en tarea:", task);
      res.status(502).json({ error: "La respuesta del agente quedo incompleta. Intenta de nuevo." });
      return;
    }

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Respaldo por si el modelo envolviera el JSON en markdown.
      const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
      parsed = JSON.parse(cleaned);
    }

    res.status(200).json({ result: unwrap(parsed) });
  } catch (e) {
    console.error("Fallo llamando al agente:", e);
    res.status(500).json({ error: "Error interno al generar la sugerencia." });
  }
}
