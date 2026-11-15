// Pasos compartidos por las herramientas: carga del caso, mapeo persistido y formulario.
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join, relative } from "node:path"
import {
  type CampoSolicitado,
  cargarCampos,
  cargarGlosario,
  cargarMaestro,
  cargarSolicitud,
  type Maestro,
  type Solicitud,
} from "./datos.ts"
import { generarExcel, generarPdf, generarValoresPortal } from "./formularios.ts"
import { type Mapeo, mapear } from "./mapeo.ts"
import { borradorCorreo, type Checklist, checklistMarkdown, type SoporteEvaluado } from "./paquete.ts"
import { dentroDe, existe, rutasCaso, type RutasCaso } from "./rutas.ts"

export interface CasoCargado {
  rutas: RutasCaso
  solicitud: Solicitud
  campos: CampoSolicitado[]
}

export async function cargarCaso(directory: string, caso: string): Promise<CasoCargado> {
  const rutas = rutasCaso(directory, caso)
  if (!(await existe(rutas.dirCaso))) throw new Error(`El caso "${caso}" no existe en fixtures/reto-01/casos/`)
  const solicitud = await cargarSolicitud(rutas)
  const campos = await cargarCampos(rutas, solicitud.formato)
  return { rutas, solicitud, campos }
}

export function rutaRelativa(directory: string, ruta: string): string {
  return relative(directory, ruta).split("\\").join("/")
}

/** Calcula el mapeo de todos los campos de la plantilla y lo guarda en out/<caso>/mapeo.json. */
export async function calcularYGuardarMapeo(c: CasoCargado): Promise<{ mapeo: Mapeo; maestro: Maestro }> {
  const [glosario, maestro] = await Promise.all([cargarGlosario(c.rutas), cargarMaestro(c.rutas)])
  const mapeo = mapear(c.rutas.caso, c.solicitud.pais, c.campos, glosario, maestro)
  await mkdir(c.rutas.dirSalida, { recursive: true })
  await writeFile(join(c.rutas.dirSalida, "mapeo.json"), JSON.stringify(mapeo, null, 2), "utf8")
  return { mapeo, maestro }
}

/** Lee el mapeo verificado. Si no existe, lo calcula: el proceso continúa con lo que sí puede hacer. */
export async function obtenerMapeo(c: CasoCargado): Promise<{ mapeo: Mapeo; generado: boolean }> {
  const ruta = join(c.rutas.dirSalida, "mapeo.json")
  if (await existe(ruta)) {
    const mapeo = JSON.parse(await readFile(ruta, "utf8")) as Mapeo
    return { mapeo, generado: false }
  }
  return { mapeo: (await calcularYGuardarMapeo(c)).mapeo, generado: true }
}

export function nombreFormulario(c: CasoCargado): string {
  const nombres = { xlsx: "formulario.xlsx", pdf: "formulario.pdf", portal: "valores-portal.md" } as const
  return nombres[c.solicitud.formato]
}

/** HU-4: recrea out/<caso>/paquete/ con formulario, soportes, checklist y borrador; guarda estado.json. */
export async function escribirPaquete(
  c: CasoCargado,
  mapeo: Mapeo,
  maestro: Maestro,
  soportes: SoporteEvaluado[],
  checklist: Checklist,
): Promise<void> {
  const formulario = nombreFormulario(c)
  await rm(c.rutas.dirPaquete, { recursive: true, force: true })
  await mkdir(c.rutas.dirPaquete, { recursive: true })
  await copyFile(join(c.rutas.dirSalida, formulario), join(c.rutas.dirPaquete, formulario))
  for (const s of soportes) {
    if (s.archivo) await copyFile(dentroDe(c.rutas.dirSoportes, s.archivo), join(c.rutas.dirPaquete, s.archivo))
  }
  await writeFile(join(c.rutas.dirPaquete, "checklist.md"), checklistMarkdown(checklist, c.solicitud, mapeo), "utf8")
  await writeFile(join(c.rutas.dirPaquete, "borrador-correo.md"), borradorCorreo(c.solicitud, maestro, soportes, formulario), "utf8")
  const estado = { caso: c.rutas.caso, listo_para_firma: checklist.bloqueos.length === 0, bloqueos: checklist.bloqueos, fecha_referencia: checklist.fecha_referencia }
  await writeFile(join(c.rutas.dirSalida, "estado.json"), JSON.stringify(estado, null, 2), "utf8")
}

/** Escribe el formulario en el formato del cliente y devuelve su ruta absoluta. */
export async function escribirFormulario(c: CasoCargado, mapeo: Mapeo): Promise<string> {
  const ruta = join(c.rutas.dirSalida, nombreFormulario(c))
  await mkdir(c.rutas.dirSalida, { recursive: true })
  if (c.solicitud.formato === "xlsx") await generarExcel(mapeo, ruta)
  else if (c.solicitud.formato === "pdf") await generarPdf(mapeo, c.solicitud, ruta)
  else await generarValoresPortal(mapeo, c.solicitud, ruta)
  return ruta
}
