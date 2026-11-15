// Registro de ejecución (RN5 y CA4): out/log.jsonl global y out/<caso>/log.jsonl por caso.
import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { dentroDe } from "./rutas.ts"

export interface EntradaLog {
  herramienta: string
  ok: boolean
  resumen: string
  sessionId: string
}

async function agregar(ruta: string, linea: string): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true })
  await appendFile(ruta, `${linea}\n`, "utf8")
}

export async function registrar(directory: string, caso: string | null, entrada: EntradaLog): Promise<void> {
  const linea = JSON.stringify({ ts: new Date().toISOString(), ...entrada })
  await agregar(dentroDe(directory, "out", "log.jsonl"), linea)
  if (caso) await agregar(dentroDe(directory, "out", caso, "log.jsonl"), linea)
}
