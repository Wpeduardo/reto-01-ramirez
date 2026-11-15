// Esquemas de los fixtures y funciones para cargarlos. Un fixture que no cumple el esquema se
// reporta como "corrupto" en lugar de propagar datos inesperados al agente.
import { join } from "node:path"
import { z } from "zod"
import { existe, leerJson, type RutasCaso } from "./rutas.ts"

export const esquemaFormato = z.enum(["xlsx", "pdf", "portal"])
export type Formato = z.infer<typeof esquemaFormato>

const esquemaSolicitud = z.object({
  id: z.string(),
  de: z.string(),
  asunto: z.string(),
  fecha: z.string(),
  pais: z.string().length(2),
  cliente: z.string(),
  formato: esquemaFormato,
  cuerpo: z.string(),
  adjuntos: z.array(z.string()),
})
export type Solicitud = z.infer<typeof esquemaSolicitud>

const esquemaCelda = z.object({
  hoja: z.string().min(1),
  celda_etiqueta: z.string().regex(/^[A-Z]{1,3}[0-9]{1,5}$/),
  etiqueta: z.string().min(1),
  celda_valor: z.string().regex(/^[A-Z]{1,3}[0-9]{1,5}$/),
})
const esquemaPlantillaCeldas = z.array(esquemaCelda).min(1)
const esquemaPlantillaCampos = z.array(z.object({ etiqueta: z.string().min(1), obligatorio: z.boolean() })).min(1)

export interface UbicacionExcel {
  hoja: string
  celda_etiqueta: string
  celda_valor: string
}

export interface CampoSolicitado {
  etiqueta: string
  obligatorio: boolean | null
  ubicacion: UbicacionExcel | null
}

const esquemaSoporte = z.object({
  tipo: z.string(),
  archivo: z.string().regex(/^[A-Za-z0-9._-]+$/),
  vigencia_hasta: z.string().nullable(),
  pais_emisor: z.string(),
  descripcion: z.string(),
})
export type Soporte = z.infer<typeof esquemaSoporte>

const esquemaGlosario = z.record(z.string(), z.string())
const esquemaMaestro = z.record(z.string(), z.unknown())
export type Maestro = Record<string, unknown>

export async function cargarSolicitud(r: RutasCaso): Promise<Solicitud> {
  return leerJson(join(r.dirCaso, "solicitud.json"), esquemaSolicitud, "solicitud.json")
}

/** Carga la plantilla según el formato. Los portales no tienen plantilla: se usan los campos del maestro del glosario. */
export async function cargarCampos(r: RutasCaso, formato: Formato): Promise<CampoSolicitado[]> {
  const rutaCeldas = join(r.dirCaso, "plantilla-celdas.json")
  const rutaCampos = join(r.dirCaso, "plantilla-campos.json")
  if (formato === "xlsx") {
    const celdas = await leerJson(rutaCeldas, esquemaPlantillaCeldas, "plantilla-celdas.json")
    return celdas.map(({ etiqueta, ...ubicacion }) => ({ etiqueta, obligatorio: null, ubicacion }))
  }
  if (await existe(rutaCampos)) {
    const campos = await leerJson(rutaCampos, esquemaPlantillaCampos, "plantilla-campos.json")
    return campos.map((c) => ({ etiqueta: c.etiqueta, obligatorio: c.obligatorio, ubicacion: null }))
  }
  if (formato === "pdf") throw new Error("No existe el archivo plantilla-campos.json")
  return []
}

export async function cargarSoportesExigidos(r: RutasCaso): Promise<string[]> {
  return leerJson(join(r.dirCaso, "soportes-exigidos.json"), z.array(z.string()), "soportes-exigidos.json")
}

export async function cargarIndiceSoportes(r: RutasCaso): Promise<Soporte[]> {
  return leerJson(join(r.dirSoportes, "index.json"), z.array(esquemaSoporte), "repositorio/soportes/index.json")
}

export async function cargarGlosario(r: RutasCaso): Promise<Record<string, string>> {
  return leerJson(r.glosario, esquemaGlosario, "glosario-campos.json")
}

export async function cargarMaestro(r: RutasCaso): Promise<Maestro> {
  return leerJson(join(r.dirRepositorio, "maestro.json"), esquemaMaestro, "repositorio/maestro.json")
}
