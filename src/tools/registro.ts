// Registro de herramientas: descubre los exports de cada archivo de src/tools/, los expone al
// modelo como <archivo>_<export>, valida sus argumentos con zod y registra cada ejecución.
import { z } from "zod"
import { registrar } from "./lib/log.ts"
import { esquemaCaso, existe, rutasCaso } from "./lib/rutas.ts"
import * as proveedor from "./proveedor.ts"
import type { ContextoHerramienta, Herramienta } from "./tipos.ts"
import { fallo } from "./tipos.ts"

const ARCHIVOS: Record<string, Record<string, unknown>> = { proveedor }

export interface HerramientaRegistrada {
  nombre: string
  descripcion: string
  esquema: z.ZodObject<z.ZodRawShape>
  herramienta: Herramienta
}

export interface DefinicionHerramienta {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface Ejecucion {
  nombre: string
  args: unknown
  resultado: string
  ok: boolean
  resumen: string
}

function esHerramienta(valor: unknown): valor is Herramienta {
  if (typeof valor !== "object" || valor === null) return false
  const v = valor as Record<string, unknown>
  return typeof v.description === "string" && typeof v.args === "object" && typeof v.execute === "function"
}

export const herramientas: HerramientaRegistrada[] = Object.entries(ARCHIVOS).flatMap(([archivo, modulo]) =>
  Object.entries(modulo)
    .filter((par): par is [string, Herramienta] => esHerramienta(par[1]))
    .map(([nombre, herramienta]) => ({
      nombre: `${archivo}_${nombre}`,
      descripcion: herramienta.description,
      esquema: z.object(herramienta.args).strict(),
      herramienta,
    })),
)

export function definicionesParaModelo(): DefinicionHerramienta[] {
  return herramientas.map((h) => {
    const { $schema: _omitido, ...esquema } = z.toJSONSchema(h.esquema) as Record<string, unknown>
    return { name: h.nombre, description: h.descripcion, input_schema: esquema }
  })
}

/** Resumen corto y sin datos sensibles para el log y el chat. */
export function resumir(resultado: string): { ok: boolean; resumen: string } {
  try {
    const r = JSON.parse(resultado) as { ok: boolean; data?: unknown; error?: string }
    if (!r.ok) return { ok: false, resumen: r.error ?? "error" }
    const data = (r.data ?? {}) as Record<string, unknown>
    const claves = ["ruta", "formato", "listo_para_firma", "resumen", "cliente", "pais"]
    const partes = claves.filter((k) => k in data).map((k) => `${k}=${JSON.stringify(data[k])}`)
    return { ok: true, resumen: partes.join(" · ") || "ok" }
  } catch {
    return { ok: false, resumen: "resultado no es JSON" }
  }
}

/** Caso válido y existente del que sale la ejecución; evita crear carpetas en out/ para casos inventados. */
async function casoDe(args: unknown, directory: string): Promise<string | null> {
  if (typeof args !== "object" || args === null) return null
  const caso = esquemaCaso.safeParse((args as Record<string, unknown>).caso)
  if (!caso.success) return null
  return (await existe(rutasCaso(directory, caso.data).dirCaso)) ? caso.data : null
}

export async function ejecutarHerramienta(nombre: string, args: unknown, ctx: ContextoHerramienta): Promise<Ejecucion> {
  const registrada = herramientas.find((h) => h.nombre === nombre)
  let resultado: string
  if (!registrada) {
    resultado = fallo(`Herramienta desconocida: ${nombre}`)
  } else {
    const validacion = registrada.esquema.safeParse(args)
    resultado = validacion.success
      ? await registrada.herramienta.execute(validacion.data, ctx)
      : fallo(`Argumentos inválidos: ${validacion.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`)
  }
  const { ok, resumen } = resumir(resultado)
  await registrar(ctx.directory, await casoDe(args, ctx.directory), { herramienta: nombre, ok, resumen, sessionId: ctx.sessionId }).catch(() => {})
  return { nombre, args, resultado, ok, resumen }
}
