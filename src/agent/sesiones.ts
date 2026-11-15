// Sesiones en memoria con copia en out/sessions/<id>.json (sin base de datos).
import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import type { Mensaje } from "../llm/adapter.ts"
import { dentroDe } from "../tools/lib/rutas.ts"

export type EventoVisible =
  | { tipo: "usuario"; texto: string; ts: string }
  | { tipo: "asistente"; texto: string; ts: string; needsConfirmation: boolean }
  | { tipo: "herramienta"; nombre: string; args: unknown; ok: boolean; resumen: string; ts: string }
  | { tipo: "error"; texto: string; ts: string }

export interface Sesion {
  id: string
  mensajes: Mensaje[]
  historial: EventoVisible[]
  tokens: number
  /** Caso cuyo envío espera confirmación del usuario en su próximo mensaje. */
  pendiente: string | null
}

const ID_VALIDO = /^[A-Za-z0-9-]{8,64}$/
const memoria = new Map<string, Sesion>()

function ruta(directory: string, id: string): string {
  return dentroDe(directory, "out", "sessions", `${id}.json`)
}

export function idValido(id: string): boolean {
  return ID_VALIDO.test(id)
}

export async function obtenerSesion(directory: string, id: string): Promise<Sesion | null> {
  if (!idValido(id)) return null
  const enMemoria = memoria.get(id)
  if (enMemoria) return enMemoria
  try {
    const sesion = JSON.parse(await readFile(ruta(directory, id), "utf8")) as Sesion
    memoria.set(id, sesion)
    return sesion
  } catch {
    return null
  }
}

export async function obtenerOCrear(directory: string, id: string | undefined): Promise<Sesion> {
  const existente = id ? await obtenerSesion(directory, id) : null
  if (existente) return existente
  const nueva: Sesion = { id: id && idValido(id) ? id : randomUUID(), mensajes: [], historial: [], tokens: 0, pendiente: null }
  memoria.set(nueva.id, nueva)
  return nueva
}

export async function guardarSesion(directory: string, sesion: Sesion): Promise<void> {
  const destino = ruta(directory, sesion.id)
  await mkdir(dentroDe(directory, "out", "sessions"), { recursive: true })
  await writeFile(destino, JSON.stringify(sesion, null, 2), "utf8")
}

export function ahora(): string {
  return new Date().toISOString()
}
