// Ciclo del agente: prompt → modelo → herramientas → modelo … hasta una respuesta de texto o el
// tope de iteraciones (CA1). La confirmación humana se aplica aquí, no en el prompt (CA3).
import { readFile } from "node:fs/promises"
import { type AdaptadorLLM, type Bloque, ErrorLLM } from "../llm/adapter.ts"
import { definicionesParaModelo, ejecutarHerramienta } from "../tools/registro.ts"
import { dentroDe } from "../tools/lib/rutas.ts"
import { esConfirmacion } from "./confirmacion.ts"
import { ahora, guardarSesion, type Sesion } from "./sesiones.ts"

const HERRAMIENTA_ENVIO = "proveedor_simular_envio"
const HERRAMIENTA_PAQUETE = "proveedor_armar_paquete"

export interface Dependencias {
  adaptador: AdaptadorLLM
  sistema: string
  directory: string
  maxIteraciones: number
  maxTokensSesion: number
}

export interface LlamadaVisible {
  nombre: string
  args: unknown
  ok: boolean
  resumen: string
}

export interface ResultadoTurno {
  sessionId: string
  reply: string
  toolCalls: LlamadaVisible[]
  needsConfirmation: boolean
  error: string | null
}

type BloqueHerramienta = Extract<Bloque, { tipo: "herramienta" }>

/** System prompt (comportamiento) + conocimiento del proceso, cada uno en su propio archivo. */
export async function cargarSistema(directory: string): Promise<string> {
  const [prompt, conocimiento] = await Promise.all([
    readFile(dentroDe(directory, "agent", "prompt.md"), "utf8"),
    readFile(dentroDe(directory, "src", "knowledge", "registro-proveedor.md"), "utf8"),
  ])
  return `${prompt}\n\n---\n\n# Conocimiento del proceso\n\n${conocimiento}`
}

function casoDe(args: unknown): string | null {
  const caso = typeof args === "object" && args !== null ? (args as Record<string, unknown>).caso : null
  return typeof caso === "string" ? caso : null
}

/** El valor de `confirmado` lo decide el backend: solo es true si el usuario confirmó ese caso. */
async function ejecutarLlamada(sesion: Sesion, llamada: BloqueHerramienta, estado: { confirmacion: string | null }, deps: Dependencias) {
  let args = llamada.args
  const caso = casoDe(args)
  if (llamada.nombre === HERRAMIENTA_ENVIO) {
    const autorizado = estado.confirmacion !== null && caso === estado.confirmacion
    args = { ...(typeof args === "object" && args !== null ? args : {}), confirmado: autorizado }
    if (autorizado) estado.confirmacion = null
  }
  const ejecucion = await ejecutarHerramienta(llamada.nombre, args, { directory: deps.directory, sessionId: sesion.id })
  if (llamada.nombre === HERRAMIENTA_PAQUETE && ejecucion.ok) sesion.pendiente = caso
  if (llamada.nombre === HERRAMIENTA_ENVIO) sesion.pendiente = ejecucion.ok ? null : caso
  sesion.historial.push({ tipo: "herramienta", nombre: llamada.nombre, args, ok: ejecucion.ok, resumen: ejecucion.resumen, ts: ahora() })
  const resultado: Bloque = { tipo: "resultado", id: llamada.id, nombre: llamada.nombre, contenido: ejecucion.resultado, error: !ejecucion.ok }
  return { resultado, visible: { nombre: llamada.nombre, args, ok: ejecucion.ok, resumen: ejecucion.resumen } }
}

function textoDe(bloques: Bloque[]): string {
  return bloques.flatMap((b) => (b.tipo === "texto" ? [b.texto] : [])).join("\n").trim()
}

function mensajeTope(llamadas: LlamadaVisible[], tope: number): string {
  const hechas = llamadas.map((l) => `- ${l.nombre}: ${l.ok ? "ok" : "error"} (${l.resumen})`).join("\n")
  return `Alcancé el tope de ${tope} pasos en este turno. Esto es lo que alcancé a hacer:\n${hechas || "- Nada"}\n\nEscríbeme "continúa" para seguir con lo que falta.`
}

async function iterar(sesion: Sesion, deps: Dependencias, estado: { confirmacion: string | null }, llamadas: LlamadaVisible[]): Promise<string> {
  const herramientas = definicionesParaModelo()
  for (let i = 0; i < deps.maxIteraciones; i++) {
    const respuesta = await deps.adaptador.enviar({ sistema: deps.sistema, mensajes: sesion.mensajes, herramientas })
    sesion.tokens += respuesta.uso.entrada + respuesta.uso.salida
    const bloques = respuesta.bloques.length > 0 ? respuesta.bloques : [{ tipo: "texto" as const, texto: "(sin respuesta)" }]
    sesion.mensajes.push({ rol: "asistente", bloques })
    const pedidas = bloques.filter((b): b is BloqueHerramienta => b.tipo === "herramienta")
    if (pedidas.length === 0) return textoDe(bloques) || "No obtuve una respuesta del modelo."
    const resultados: Bloque[] = []
    for (const llamada of pedidas) {
      const { resultado, visible } = await ejecutarLlamada(sesion, llamada, estado, deps)
      resultados.push(resultado)
      llamadas.push(visible)
    }
    sesion.mensajes.push({ rol: "usuario", bloques: resultados })
    if (sesion.tokens >= deps.maxTokensSesion) return `Alcancé el tope de tokens de la sesión.\n\n${mensajeTope(llamadas, deps.maxIteraciones)}`
  }
  return mensajeTope(llamadas, deps.maxIteraciones)
}

export async function procesarTurno(sesion: Sesion, texto: string, deps: Dependencias): Promise<ResultadoTurno> {
  const estado = { confirmacion: sesion.pendiente !== null && esConfirmacion(texto) ? sesion.pendiente : null }
  sesion.pendiente = null
  sesion.historial.push({ tipo: "usuario", texto, ts: ahora() })
  const llamadas: LlamadaVisible[] = []
  let reply: string
  let error: string | null = null

  if (sesion.tokens >= deps.maxTokensSesion) {
    reply = "Esta sesión alcanzó su tope de tokens. Abre una sesión nueva para continuar."
  } else {
    const inicio = sesion.mensajes.length
    sesion.mensajes.push({ rol: "usuario", bloques: [{ tipo: "texto", texto }] })
    try {
      reply = await iterar(sesion, deps, estado, llamadas)
    } catch (e) {
      sesion.mensajes.length = inicio
      sesion.pendiente = null
      error = e instanceof ErrorLLM ? e.message : "Error inesperado al procesar el mensaje"
      reply = `No pude completar tu solicitud: ${error}. Las acciones ya ejecutadas se muestran arriba; puedes intentarlo de nuevo.`
    }
  }
  const needsConfirmation = sesion.pendiente !== null
  sesion.historial.push(error ? { tipo: "error", texto: reply, ts: ahora() } : { tipo: "asistente", texto: reply, ts: ahora(), needsConfirmation })
  await guardarSesion(deps.directory, sesion).catch(() => {})
  return { sessionId: sesion.id, reply, toolCalls: llamadas, needsConfirmation, error }
}
