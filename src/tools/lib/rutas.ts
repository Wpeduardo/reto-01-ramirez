import { access, readFile } from "node:fs/promises"
import { resolve, sep } from "node:path"
import { z } from "zod"

/** Nombre de caso: solo minúsculas, dígitos y guiones. Impide rutas como "../../.env". */
export const esquemaCaso = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "El caso solo admite minúsculas, dígitos y guiones")
  .describe('Nombre de la carpeta del caso en fixtures/reto-01/casos/, por ejemplo "ec-corp-andina"')

export interface RutasCaso {
  caso: string
  dirCaso: string
  dirSalida: string
  dirPaquete: string
  dirRepositorio: string
  dirSoportes: string
  glosario: string
}

/** Resuelve una ruta y verifica que quede dentro de la carpeta base. */
export function dentroDe(base: string, ...partes: string[]): string {
  const raiz = resolve(base)
  const ruta = resolve(raiz, ...partes)
  if (ruta !== raiz && !ruta.startsWith(raiz + sep)) {
    throw new Error(`Ruta fuera del directorio permitido: ${partes.join("/")}`)
  }
  return ruta
}

export function rutasCaso(directory: string, caso: string): RutasCaso {
  const fixtures = dentroDe(directory, "fixtures", "reto-01")
  const dirSalida = dentroDe(directory, "out", caso)
  return {
    caso,
    dirCaso: dentroDe(fixtures, "casos", caso),
    dirSalida,
    dirPaquete: dentroDe(dirSalida, "paquete"),
    dirRepositorio: dentroDe(fixtures, "repositorio"),
    dirSoportes: dentroDe(fixtures, "repositorio", "soportes"),
    glosario: dentroDe(fixtures, "glosario-campos.json"),
  }
}

/** Lee y valida un JSON. Lanza un error legible si no existe, no es JSON o no cumple el esquema. */
export async function leerJson<T>(ruta: string, esquema: z.ZodType<T>, nombre: string): Promise<T> {
  let texto: string
  try {
    texto = await readFile(ruta, "utf8")
  } catch {
    throw new Error(`No existe el archivo ${nombre}`)
  }
  let crudo: unknown
  try {
    crudo = JSON.parse(texto)
  } catch {
    throw new Error(`El archivo ${nombre} está corrupto: no es JSON válido`)
  }
  const resultado = esquema.safeParse(crudo)
  if (!resultado.success) {
    const detalle = resultado.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
    throw new Error(`El archivo ${nombre} tiene un formato inesperado (${detalle.slice(0, 3).join("; ")})`)
  }
  return resultado.data
}

export async function existe(ruta: string): Promise<boolean> {
  try {
    await access(ruta)
    return true
  } catch {
    return false
  }
}
