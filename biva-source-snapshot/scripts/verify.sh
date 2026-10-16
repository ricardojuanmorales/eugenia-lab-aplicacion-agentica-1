#!/usr/bin/env bash
# Compuerta de verificacion para eugenia_lab_biva.
# Solo automatiza lo que realmente existe en este proyecto (ver docs/testing.md):
# no hay test suite, ni linter, ni typecheck, asi que no se inventan aqui.
#
# Uso:
#   bash scripts/verify.sh            # sintaxis + estructura (rapido, sin red)
#   bash scripts/verify.sh --network  # ademas, smoke test contra produccion (necesita internet)

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR" || exit 1

FAILS=0
WARNINGS=0
NETWORK=0
[ "${1:-}" = "--network" ] && NETWORK=1

pass() { printf '  [OK]   %s\n' "$1"; }
fail() { printf '  [FAIL] %s\n' "$1"; FAILS=$((FAILS + 1)); }
warn() { printf '  [WARN] %s\n' "$1"; WARNINGS=$((WARNINGS + 1)); }

echo "== 1. Herramientas =="
if command -v node >/dev/null 2>&1; then
  pass "node disponible ($(node --version))"
else
  fail "node no esta disponible en PATH; no se puede verificar sintaxis"
fi

echo "== 2. Sintaxis de los archivos .js reales del proyecto =="
JS_FILES="web/api/generate.js web/api/search.js web/lib/contencion.js poster/src/build_poster.js"
for f in $JS_FILES; do
  if [ ! -f "$f" ]; then
    warn "$f no existe (¿se movio o se renombro?)"
    continue
  fi
  if command -v node >/dev/null 2>&1; then
    if node --check "$f" >/dev/null 2>&1; then
      pass "sintaxis OK: $f"
    else
      fail "error de sintaxis en $f"
      node --check "$f" 2>&1 | sed 's/^/         /'
    fi
  fi
done

echo "== 3. Estructura esperada de web/ =="
[ -f "web/package.json" ] && pass "web/package.json existe" || fail "falta web/package.json"
[ -f "web/index.html" ] && pass "web/index.html existe" || fail "falta web/index.html"
[ -d "web/.vercel" ] && [ -f "web/.vercel/project.json" ] && pass "web/ esta vinculado a un proyecto de Vercel" || warn "web/.vercel/project.json no existe: 'vercel dev' / 'vercel --prod' pedira vincular el proyecto"

echo "== 4. Variables de entorno locales (solo existencia, nunca se imprime el valor) =="
if [ -f "web/.env.local" ]; then
  if grep -q '^ANTHROPIC_API_KEY=' "web/.env.local" 2>/dev/null; then
    pass "web/.env.local tiene ANTHROPIC_API_KEY definida"
  else
    warn "web/.env.local existe pero no tiene ANTHROPIC_API_KEY; 'vercel dev' respondera 500 en /api/generate y /api/search"
  fi
else
  warn "web/.env.local no existe; correr 'npx vercel env pull .env.local' desde web/ antes de usar 'vercel dev'"
fi

echo "== 5. Control de versiones =="
if [ -d ".git" ]; then
  pass "repositorio git detectado"
else
  warn "no hay repositorio git en este directorio (ver AGENTS.md, es un riesgo conocido, no se resuelve aqui)"
fi

if [ "$NETWORK" = "1" ]; then
  echo "== 6. Smoke test de red contra produccion (--network) =="
  PROD_URL="${PROD_URL:-https://web-beta-hazel-49.vercel.app}"
  if command -v curl >/dev/null 2>&1; then
    BODY="$(curl -s -m 10 "$PROD_URL/api/search" 2>/dev/null)"
    if [ "$BODY" = '{"error":"Metodo no permitido"}' ]; then
      pass "GET $PROD_URL/api/search responde el error esperado (endpoint vivo)"
    else
      warn "GET $PROD_URL/api/search no dio la respuesta esperada (¿sin red, o cambio el endpoint?): $BODY"
    fi
  else
    warn "curl no disponible; no se pudo hacer el smoke test de red"
  fi
else
  echo "== 6. Smoke test de red: omitido (correr con --network para incluirlo) =="
fi

echo ""
echo "Resumen: $FAILS fallo(s), $WARNINGS advertencia(s)."
if [ "$FAILS" -gt 0 ]; then
  echo "Verificacion FALLIDA."
  exit 1
fi
echo "Verificacion OK (revisar advertencias arriba si las hay)."
exit 0
