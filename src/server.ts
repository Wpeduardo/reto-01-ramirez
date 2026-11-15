// API HTTP del chat y servidor del front. Un solo proceso levanta ambos: `bun run dev`.
import { timingSafeEqual } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { extname } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { cargarSistema, procesarTurno } from "./agent/ciclo.ts"
import { obtenerOCrear, obtenerSesion } from "./agent/sesiones.ts"
import { leerConfig } from "./config.ts"
import { crearAdaptador } from "./llm/index.ts"
import { dentroDe } from "./tools/lib/rutas.ts"

const directory = fileURLToPath(new URL("..", import.meta.url))
const config = leerConfig()
const adaptador = crearAdaptador(config)
const sistema = await cargarSistema(directory)
const configurado = config.apiKey.length > 0 || (config.proveedor === "openai" && !config.openaiBaseUrl.startsWith("https://api.openai.com"))
const ocupadas = new Set<string>()
const solicitudesPorIp = new Map<string, number[]>()

const esquemaChat = z.object({
  sessionId: z.string().max(64).nullish(),
  message: z.string().trim().min(1, "El mensaje está vacío").max(4000, "El mensaje es demasiado largo"),
})

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
}

function enviar(res: ServerResponse, status: number, cuerpo: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  res.end(JSON.stringify(cuerpo))
}

async function leerCuerpo(req: IncomingMessage): Promise<unknown> {
  const partes: Buffer[] = []
  let total = 0
  for await (const parte of req) {
    total += (parte as Buffer).length
    if (total > 32_000) throw new Error("Cuerpo demasiado grande")
    partes.push(parte as Buffer)
  }
  return JSON.parse(Buffer.concat(partes).toString("utf8") || "{}")
}

function autorizado(req: IncomingMessage): boolean {
  if (!config.accessKey) return true
  const recibida = Buffer.from(String(req.headers["x-access-key"] ?? ""))
  const esperada = Buffer.from(config.accessKey)
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada)
}

/** Límite simple por IP para que nadie gaste la clave del modelo sin control. */
function dentroDelLimite(req: IncomingMessage): boolean {
  const ip = req.socket.remoteAddress ?? "?"
  const ahora = Date.now()
  const recientes = (solicitudesPorIp.get(ip) ?? []).filter((t) => ahora - t < 60_000)
  recientes.push(ahora)
  solicitudesPorIp.set(ip, recientes)
  return recientes.length <= config.limitePorMinuto
}

async function chat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!dentroDelLimite(req)) return enviar(res, 429, { error: "Demasiados mensajes. Espera un minuto." })
  let cuerpo: unknown
  try {
    cuerpo = await leerCuerpo(req)
  } catch {
    return enviar(res, 400, { error: "El cuerpo de la petición no es JSON válido" })
  }
  const datos = esquemaChat.safeParse(cuerpo)
  if (!datos.success) return enviar(res, 400, { error: datos.error.issues[0]?.message ?? "Petición inválida" })
  const sesion = await obtenerOCrear(directory, datos.data.sessionId ?? undefined)
  if (ocupadas.has(sesion.id)) return enviar(res, 409, { error: "La sesión todavía está procesando el mensaje anterior" })
  ocupadas.add(sesion.id)
  try {
    const deps = { adaptador, sistema, directory, maxIteraciones: config.maxIteraciones, maxTokensSesion: config.maxTokensSesion }
    enviar(res, 200, await procesarTurno(sesion, datos.data.message, deps))
  } finally {
    ocupadas.delete(sesion.id)
  }
}

async function estatico(ruta: string, res: ServerResponse): Promise<void> {
  const archivo = ruta === "/" ? "index.html" : ruta.slice(1)
  try {
    const destino = dentroDe(directory, "web", archivo)
    const contenido = await readFile(destino)
    res.writeHead(200, {
      "content-type": TIPOS[extname(destino)] ?? "application/octet-stream",
      "content-security-policy": "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    })
    res.end(contenido)
  } catch {
    enviar(res, 404, { error: "No encontrado" })
  }
}

async function enrutar(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost")
  if (req.method === "GET" && url.pathname === "/api/health") {
    return enviar(res, 200, {
      ok: true,
      provider: adaptador.proveedor,
      model: adaptador.modelo,
      configured: configurado,
      accessKeyRequired: config.accessKey.length > 0,
    })
  }
  if (url.pathname.startsWith("/api/") && !autorizado(req)) return enviar(res, 401, { error: "Clave de acceso inválida" })
  if (req.method === "POST" && url.pathname === "/api/chat") return chat(req, res)
  const sesion = /^\/api\/sessions\/([A-Za-z0-9-]+)$/.exec(url.pathname)
  if (req.method === "GET" && sesion?.[1]) {
    const encontrada = await obtenerSesion(directory, sesion[1])
    return encontrada
      ? enviar(res, 200, { sessionId: encontrada.id, history: encontrada.historial, needsConfirmation: encontrada.pendiente !== null })
      : enviar(res, 404, { error: "Sesión no encontrada" })
  }
  if (req.method === "GET" && !url.pathname.startsWith("/api/")) return estatico(url.pathname, res)
  enviar(res, 404, { error: "No encontrado" })
}

createServer((req, res) => {
  enrutar(req, res).catch(() => enviar(res, 500, { error: "Error interno del servidor" }))
}).listen(config.puerto, () => {
  console.log(`Agente listo en http://localhost:${config.puerto} · ${adaptador.proveedor}/${adaptador.modelo}`)
  if (!configurado) console.warn("Aviso: no hay clave del proveedor configurada; el chat responderá con un error claro.")
})
