// Contencion de costo para los dos endpoints publicos de la app.
//
// Por que existe este archivo (2026-07-25): /api/generate y /api/search estaban
// abiertos. Sin autenticacion, sin verificacion de origen y sin limite de peticiones,
// cualquiera con la URL podia llamarlos desde una terminal, sin pasar por la app, y el
// gasto lo pagaba la clave de ANTHROPIC_API_KEY del proyecto. Los esquemas JSON y los
// prompts fijos impiden usarlo como un "Claude gratis" generico (solo se puede pedir una
// MDE, una sintesis, etc.), pero si permitian gastar dinero ajeno de forma automatizada.
//
// LO QUE ESTO SI HACE: sube mucho el costo de un abuso casual (un script, alguien
// copiando la URL del endpoint desde las herramientas de desarrollador).
//
// LO QUE ESTO NO HACE: no detiene a un atacante decidido. La cabecera Origin la puede
// falsificar cualquier cliente que no sea un navegador, y el limite por IP se evade
// rotando IPs. El unico limite duro real es el TOPE DE GASTO MENSUAL en la consola de
// Anthropic. Esto es defensa en profundidad, no un candado.

// ---- Limites configurables ----
// Se pueden apretar desde Vercel sin tocar codigo. Los valores por defecto son
// deliberadamente holgados por el congreso: decenas de asistentes conectados al mismo
// WiFi salen a internet con UNA sola IP publica (NAT), asi que un limite por IP estricto
// castigaria a un salon lleno de gente usando la app de forma legitima. Ver la nota sobre
// esa tension en docs/decisions.md (2026-07-25).
function num(v, porDefecto) {
  const n = parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
}

const LIMITE_MINUTO = num(process.env.LIMITE_POR_MINUTO, 60);
const LIMITE_HORA = num(process.env.LIMITE_POR_HORA, 600);
const VENTANA_MINUTO = 60 * 1000;
const VENTANA_HORA = 60 * 60 * 1000;

// Cuantas IPs distintas se recuerdan a la vez. Cota de memoria: sin esto, una rafaga
// desde muchas IPs distintas haria crecer el mapa sin limite dentro de la instancia.
const MAX_IPS = 5000;

// ---- Origen ----

// La app se sirve del mismo dominio que la API, asi que el navegador manda Origin en cada
// POST (la especificacion de Fetch lo exige para metodos que no sean GET o HEAD, incluso
// en peticiones al mismo origen). Un script con curl no lo manda a menos que lo simule.
export function origenesPermitidos() {
  const lista = [];
  for (const o of String(process.env.ORIGENES_PERMITIDOS || "").split(",")) {
    const limpio = o.trim();
    if (limpio) lista.push(limpio);
  }
  // Vercel inyecta estas dos en tiempo de ejecucion. Incluirlas evita que un despliegue
  // nuevo o una URL de vista previa se rompa sola por no estar en la lista.
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    lista.push("https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL);
  }
  if (process.env.VERCEL_URL) {
    lista.push("https://" + process.env.VERCEL_URL);
  }
  // Alias oficial del proyecto, el que apunta el QR impreso del poster.
  lista.push("https://web-beta-hazel-49.vercel.app");
  // Desarrollo local con `vercel dev`.
  lista.push("http://localhost:3000", "http://127.0.0.1:3000");
  return lista;
}

export function origenDe(req) {
  const h = (req && req.headers) || {};
  const directo = h.origin || h.Origin;
  if (directo) return String(directo);
  // Respaldo: algunos navegadores viejos omiten Origin pero mandan Referer.
  const ref = h.referer || h.Referer;
  if (ref) {
    try {
      return new URL(String(ref)).origin;
    } catch {
      return "";
    }
  }
  return "";
}

export function origenPermitido(req) {
  const origen = origenDe(req);
  if (!origen) return false;
  return origenesPermitidos().includes(origen);
}

// ---- Ritmo (limite de peticiones por IP) ----

// Memoria dentro de la instancia.
//
// Se comprobo contra produccion el 2026-07-25 que Vercel SI reutiliza la instancia caliente
// entre peticiones seguidas (seis peticiones consecutivas compartieron el mismo modulo), asi
// que este contador funciona y no es codigo muerto. Lo que NO es, es global: cuando Vercel
// escala a varias instancias en paralelo, cada una lleva su propio conteo y el limite
// efectivo se multiplica por el numero de instancias. Es una limitacion aceptada a
// proposito; la alternativa correcta (Vercel KV o Redis) anade una dependencia y una cuenta
// externa que no se justifican al volumen de esta app.
//
// El respaldo duro sigue siendo el tope de gasto mensual en la consola de Anthropic.
const registro = new Map();

// Marca de arranque del modulo, visible en la cabecera de diagnostico cuando
// DIAG_CONTENCION=1. Si dos peticiones seguidas reportan valores distintos, es que cada una
// corrio en una instancia recien creada y la memoria no se esta compartiendo.
const ARRANQUE = String(Date.now()).slice(-6);

// Preferencia de cabeceras: x-vercel-forwarded-for la escribe la plataforma y el cliente
// no la puede sobrescribir, asi que es la mas fiable. x-forwarded-for va de ultima porque
// es la mas facil de manipular.
export function ipDe(req) {
  const h = (req && req.headers) || {};
  const bruta =
    h["x-vercel-forwarded-for"] ||
    h["x-real-ip"] ||
    h["x-forwarded-for"] ||
    "";
  const primera = String(bruta).split(",")[0].trim();
  if (primera) return primera;
  if (req && req.socket && req.socket.remoteAddress) return String(req.socket.remoteAddress);
  return "desconocida";
}

// El contador NO se lleva por IP exacta, se lleva por prefijo de red.
//
// Por que, medido contra produccion el 2026-07-25: seis peticiones seguidas desde la misma
// computadora llegaron con seis IPs distintas (72.50.7.208, .238, .129, .129, .238, y
// 72.50.4.17). El proveedor de internet saca el trafico por un pool de direcciones (CGNAT),
// asi que contar por IP exacta nunca acumula y el limite jamas se dispara. Con /24 esas
// peticiones caen casi todas en la misma cubeta.
//
// El precio de esto es real y hay que tenerlo presente: un /24 puede cubrir a varias
// personas distintas. En el congreso, un salon entero conectado al mismo WiFi comparte
// prefijo, y por eso los limites por defecto son holgados. Si alguna vez alguien reporta un
// 429 usando la app con normalidad, lo primero que hay que subir es LIMITE_POR_MINUTO.
export function claveDeRitmo(ip) {
  const limpia = String(ip || "").trim();
  if (!limpia) return "desconocida";
  // IPv4, con o sin puerto.
  const v4 = limpia.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}/);
  if (v4) return v4[1] + "." + v4[2] + "." + v4[3] + ".0/24";
  // IPv6: los primeros 4 grupos equivalen al /64 que se asigna a un cliente.
  if (limpia.includes(":")) {
    const grupos = limpia.split(":").slice(0, 4).join(":");
    return grupos + "::/64";
  }
  return limpia;
}

function podar(ahora) {
  if (registro.size <= MAX_IPS) return;
  const corte = ahora - VENTANA_HORA;
  for (const [ip, sellos] of registro) {
    if (!sellos.length || sellos[sellos.length - 1] <= corte) registro.delete(ip);
  }
  // Si aun asi sigue lleno (rafaga real desde muchas IPs), se vacia entero: perder el
  // conteo es preferible a que la instancia se quede sin memoria.
  if (registro.size > MAX_IPS) registro.clear();
}

// Registra la peticion y dice si hay que rechazarla. `ahora` es inyectable para poder
// probar el vencimiento de las ventanas sin esperar en tiempo real.
export function revisarRitmo(ip, ahora) {
  const t = typeof ahora === "number" ? ahora : Date.now();
  podar(t);

  let sellos = registro.get(ip);
  if (!sellos) {
    sellos = [];
    registro.set(ip, sellos);
  }

  // Descartar lo que ya salio de la ventana larga. Los sellos van en orden ascendente.
  const corteHora = t - VENTANA_HORA;
  let fuera = 0;
  while (fuera < sellos.length && sellos[fuera] <= corteHora) fuera++;
  if (fuera > 0) sellos.splice(0, fuera);

  const corteMinuto = t - VENTANA_MINUTO;
  let enMinuto = 0;
  for (let k = sellos.length - 1; k >= 0 && sellos[k] > corteMinuto; k--) enMinuto++;

  if (enMinuto >= LIMITE_MINUTO) {
    const masViejoDelMinuto = sellos[sellos.length - enMinuto];
    const espera = Math.max(1, Math.ceil((masViejoDelMinuto + VENTANA_MINUTO - t) / 1000));
    return { excedido: true, ventana: "minuto", esperaSeg: espera };
  }
  if (sellos.length >= LIMITE_HORA) {
    const espera = Math.max(1, Math.ceil((sellos[0] + VENTANA_HORA - t) / 1000));
    return { excedido: true, ventana: "hora", esperaSeg: espera };
  }

  sellos.push(t);
  return { excedido: false, ventana: "", esperaSeg: 0 };
}

// Solo para pruebas: deja el contador en blanco entre casos.
export function reiniciarRitmo() {
  registro.clear();
}

// ---- Tamano del cuerpo ----

export function tamanoExcedido(valor, max) {
  try {
    return JSON.stringify(valor === undefined ? {} : valor).length > max;
  } catch {
    // Un cuerpo que ni siquiera se puede serializar (ciclos, BigInt) se rechaza.
    return true;
  }
}

// ---- Compuerta unica ----

// Devuelve true si la peticion puede seguir. Si devuelve false, ya respondio con el
// estado y el mensaje correspondientes y quien llama debe retornar de inmediato.
export function aplicarContencion(req, res) {
  if (!origenPermitido(req)) {
    console.warn("Contencion: origen rechazado:", origenDe(req) || "(sin cabecera Origin)");
    res.status(403).json({ error: "Origen no permitido." });
    return false;
  }

  const clave = claveDeRitmo(ipDe(req));
  if (process.env.DIAG_CONTENCION === "1" && typeof res.setHeader === "function") {
    res.setHeader(
      "x-diag-contencion",
      "arranque=" + ARRANQUE + ";claves=" + registro.size +
        ";sellos=" + (registro.get(clave) || []).length +
        ";clave=" + clave
    );
  }
  const ritmo = revisarRitmo(clave);
  if (ritmo.excedido) {
    console.warn("Contencion: limite por " + ritmo.ventana + " alcanzado por red:", clave);
    if (typeof res.setHeader === "function") res.setHeader("Retry-After", String(ritmo.esperaSeg));
    res.status(429).json({
      error:
        "Demasiadas solicitudes seguidas desde esta conexion. Espera unos segundos y vuelve a intentar."
    });
    return false;
  }

  return true;
}
