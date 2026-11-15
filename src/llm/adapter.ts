// Interfaz propia del proveedor de lenguaje. El ciclo del agente solo conoce estos tipos, así que
// cambiar de proveedor no toca el ciclo.
import type { DefinicionHerramienta } from "../tools/registro.ts"

export type Bloque =
  | { tipo: "texto"; texto: string }
  /** `extra`: datos propios del proveedor que deben devolverse intactos (p. ej., la firma de razonamiento de Gemini). */
  | { tipo: "herramienta"; id: string; nombre: string; args: unknown; extra?: unknown }
  | { tipo: "resultado"; id: string; nombre?: string; contenido: string; error: boolean }

export interface Mensaje {
  rol: "usuario" | "asistente"
  bloques: Bloque[]
}

export interface Uso {
  entrada: number
  salida: number
}

export interface RespuestaModelo {
  bloques: Bloque[]
  /** "herramientas" si el modelo pidió ejecutar herramientas; "limite" si se cortó por tokens. */
  fin: "fin" | "herramientas" | "limite"
  uso: Uso
}

export interface PeticionModelo {
  sistema: string
  mensajes: Mensaje[]
  herramientas: DefinicionHerramienta[]
}

export interface AdaptadorLLM {
  proveedor: string
  modelo: string
  enviar(peticion: PeticionModelo): Promise<RespuestaModelo>
}

/** Error del proveedor con un mensaje apto para mostrar en el chat (sin trazas ni claves). */
export class ErrorLLM extends Error {
  /** Código HTTP del proveedor, si lo hubo. */
  readonly status: number | null

  constructor(mensaje: string, status: number | null = null) {
    super(mensaje)
    this.name = "ErrorLLM"
    this.status = status
  }
}

export function mensajeHttp(status: number): string {
  if (status === 401 || status === 403) return "El proveedor rechazó la clave: revisa la variable de entorno del backend"
  if (status === 429) return "El proveedor limitó las solicitudes (429). Intenta de nuevo en unos segundos"
  if (status >= 500) return `El proveedor no está disponible en este momento (${status}); se reintentó varias veces`
  return `El proveedor devolvió un error (${status})`
}

/** Mensaje de error del proveedor (sin cabeceras ni claves), recortado para el chat. */
async function detalleError(respuesta: Response): Promise<string> {
  try {
    const crudo = (await respuesta.json()) as unknown
    // Algunos proveedores (por ejemplo, Gemini) envuelven el error en una lista.
    const cuerpo = (Array.isArray(crudo) ? crudo[0] : crudo) as { error?: { message?: unknown } | string } | undefined
    const mensaje = typeof cuerpo?.error === "string" ? cuerpo.error : cuerpo?.error?.message
    return typeof mensaje === "string" ? mensaje.slice(0, 300) : ""
  } catch {
    return ""
  }
}

const REINTENTABLES = new Set([429, 500, 502, 503, 504])
const ESPERAS_MS = [1_000, 3_000, 6_000]

/** Reintenta los fallos temporales del proveedor (saturación, límite de uso) con esperas crecientes. */
export async function postJson(url: string, headers: Record<string, string>, cuerpo: unknown, timeoutMs: number): Promise<unknown> {
  for (let intento = 0; ; intento++) {
    try {
      return await postJsonUnaVez(url, headers, cuerpo, timeoutMs)
    } catch (error) {
      const espera = ESPERAS_MS[intento]
      const temporal = error instanceof ErrorLLM && error.status !== null && REINTENTABLES.has(error.status)
      if (!temporal || espera === undefined) throw error
      await new Promise((r) => setTimeout(r, espera))
    }
  }
}

/** fetch con timeout que convierte los fallos de red en ErrorLLM. */
async function postJsonUnaVez(url: string, headers: Record<string, string>, cuerpo: unknown, timeoutMs: number): Promise<unknown> {
  let respuesta: Response
  try {
    respuesta = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
    throw new ErrorLLM(timeout ? `El modelo no respondió en ${Math.round(timeoutMs / 1000)} s (timeout)` : "No se pudo conectar con el proveedor del modelo")
  }
  if (!respuesta.ok) {
    const detalle = await detalleError(respuesta)
    throw new ErrorLLM(detalle ? `${mensajeHttp(respuesta.status)}: ${detalle}` : mensajeHttp(respuesta.status), respuesta.status)
  }
  return respuesta.json()
}
