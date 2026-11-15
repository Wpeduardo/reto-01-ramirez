# Reto 01 · Agente "Registro como Proveedor"

Agente conversacional que prepara los formularios de registro de Periferia IT Group como proveedor
ante sus clientes: lee la solicitud, llena el formulario solo con datos del repositorio maestro,
genera el archivo en el formato del cliente y arma el paquete para la firma del representante
legal. Nunca envía nada sin confirmación humana.

**Link de prueba:** https://reto-01-ramirez.onrender.com
**Clave de acceso:** se proporciona en el correo de entrega del reto.

> El servicio usa el plan gratuito de Render: si lleva más de 15 minutos sin tráfico, la primera
> carga puede tardar alrededor de un minuto.

## Requisitos

- [Bun](https://bun.sh) 1.1 o superior (o Docker).
- Una clave de un proveedor de modelos: Google Gemini (usado en el despliegue, a través de su API
  compatible con OpenAI), Anthropic u OpenAI, o un modelo local con API compatible con OpenAI
  (Ollama, LM Studio).

## Levantar en local (un comando)

```bash
cp .env.example .env        # y completa las variables del proveedor (ver "Usar Google Gemini")
bun install && bun run dev  # front y backend en http://localhost:3000
```

Con Docker: `docker compose up --build`.

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `LLM_PROVIDER` | No | `anthropic` (por defecto) u `openai` (también para APIs compatibles, como Gemini) |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Sí (según proveedor) | Solo vive en el backend; nunca se expone en el front, la API ni los logs |
| `ANTHROPIC_WORKSPACE_ID` | No | Solo si la clave de Anthropic no está asociada a un workspace |
| `LLM_MODEL` | No | Modelo. Por defecto `claude-sonnet-5-5` o `gpt-4.1-mini` |
| `OPENAI_BASE_URL` | No | API compatible con OpenAI distinta de la oficial (Gemini, Azure, Ollama, LM Studio) |
| `MAX_ITERACIONES` | No | Tope de llamadas herramienta → modelo por turno (25) |
| `MAX_TOKENS_SESION` | No | Tope de tokens por sesión (200000) |
| `MAX_TOKENS_RESPUESTA` | No | Tokens máximos por respuesta del modelo (2048) |
| `LLM_TIMEOUT_MS` | No | Timeout al proveedor (60000) |
| `LIMITE_MENSAJES_POR_MINUTO` | No | Límite por IP del endpoint de chat (20) |
| `ACCESS_KEY` | No | Si se define, el link pide esta clave (cabecera `x-access-key`) |
| `FECHA_REFERENCIA` | No | Fecha `YYYY-MM-DD` para evaluar vigencias. Vacía = hoy |
| `PORT` | No | Puerto HTTP (3000) |

## Usar Google Gemini (configuración del despliegue)

```
LLM_PROVIDER=openai
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
OPENAI_API_KEY=<clave de Google AI Studio>
LLM_MODEL=gemini-3.5-flash-lite
MAX_TOKENS_RESPUESTA=4096
```

Gemini se usa a través de su API compatible con OpenAI; por eso `LLM_PROVIDER=openai`.

En Gemini, el límite de tokens incluye el razonamiento interno del modelo; por eso conviene subir
`MAX_TOKENS_RESPUESTA`. En el plan gratuito, Flash-Lite permite 15 peticiones por minuto y un caso
completo usa unas 5; si aparece un error 429, basta con esperar un minuto.

## Verificación sin modelo

```bash
bun run demo.ts                              # todos los casos, sin clave
FECHA_REFERENCIA=2026-09-15 bun run demo.ts  # con fecha fija
bun test                                     # 21 pruebas, incluido el ciclo con un modelo simulado
bun run typecheck                            # TypeScript estricto
```

`demo.ts` limpia `out/` al inicio, ejecuta las cinco herramientas sobre los cuatro casos e imprime
un resumen por caso, además de comprobar que un caso inexistente y una ruta maliciosa fallan con
un error claro.

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId?, message }` → `{ sessionId, reply, toolCalls[], needsConfirmation, error }` |
| `GET` | `/api/sessions/:id` | `{ sessionId, history[], needsConfirmation }` |
| `GET` | `/api/health` | `{ ok, provider, model, configured, accessKeyRequired }` (sin claves) |

Si `ACCESS_KEY` está definida, `/api/chat` y `/api/sessions/:id` exigen la cabecera `x-access-key`.

## Despliegue

Desplegado en Render (plan gratuito) como Web Service con el `Dockerfile` del repositorio. Las
variables de la sección "Usar Google Gemini", más `ACCESS_KEY` y `PORT=3000`, se definen como
variables secretas en Render; la clave del modelo nunca está en el repositorio. Health check:
`/api/health`.

En el plan gratuito, el servicio se suspende tras 15 minutos sin tráfico y tarda alrededor de un
minuto en volver a responder. Las sesiones y salidas se escriben en `out/`, que es efímero: se
borra en cada reinicio o despliegue.

## Estructura

```
agent/prompt.md                 comportamiento (system prompt)
src/knowledge/                  conocimiento del proceso y reglas de negocio (reglas.json)
src/tools/proveedor.ts          herramientas (cada export → proveedor_<export>)
src/tools/lib/                  mapeo, formularios, paquete, rutas seguras y log
src/tools/registro.ts           validación zod, JSON Schema para el modelo y log de ejecuciones
src/agent/                      ciclo del agente, confirmación humana y sesiones
src/llm/                        adaptador propio + Anthropic y OpenAI (compatible con Gemini)
src/server.ts                   API HTTP y servidor del front
web/                            chat (HTML, CSS y JS sin dependencias)
modulo/                         bonus: agente empaquetado (generado con bun run build:modulo)
demo.ts                         herramientas sin modelo
tests/                          pruebas con bun test
```
