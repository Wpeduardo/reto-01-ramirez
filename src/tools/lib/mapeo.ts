// Cruce de los campos solicitados con el repositorio maestro. Determinista: el modelo de lenguaje
// nunca decide un valor; solo puede leer el resultado de este mapeo.
import reglas from "../../knowledge/reglas.json" with { type: "json" }
import type { CampoSolicitado, Maestro, UbicacionExcel } from "./datos.ts"

export type Estado = "lleno" | "faltante" | "requiere_confirmacion"
export type Valor = string | number | boolean

export interface EntradaMapeo {
  etiqueta: string
  estado: Estado
  clave: string | null
  valor: Valor | null
  fuente: string | null
  confianza: number
  obligatorio: boolean | null
  motivo: string | null
  nota: string | null
  ubicacion: UbicacionExcel | null
}

export interface Mapeo {
  caso: string
  pais: string
  entradas: EntradaMapeo[]
}

interface Contexto {
  pais: string
  glosario: Record<string, string>
  glosarioNormalizado: Map<string, string>
  maestro: Maestro
}

const identificadores: Record<string, string> = reglas.identificador_tributario_por_pais

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** Lee una ruta con puntos ("banco.numero_cuenta") del maestro. Solo devuelve valores primitivos. */
export function valorEnMaestro(maestro: Maestro, clave: string): Valor | undefined {
  let actual: unknown = maestro
  for (const parte of clave.split(".")) {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) return undefined
    actual = (actual as Record<string, unknown>)[parte]
  }
  const tipo = typeof actual
  return tipo === "string" || tipo === "number" || tipo === "boolean" ? (actual as Valor) : undefined
}

function buscarClave(etiqueta: string, ctx: Contexto): { clave: string; confianza: number } | null {
  const exacta = ctx.glosario[etiqueta]
  if (exacta) return { clave: exacta, confianza: reglas.confianza.glosario_exacto }
  const normalizada = ctx.glosarioNormalizado.get(normalizar(etiqueta))
  if (normalizada) return { clave: normalizada, confianza: reglas.confianza.glosario_normalizado }
  const inferida = normalizar(etiqueta).replace(/ /g, "_")
  if (valorEnMaestro(ctx.maestro, inferida) !== undefined) {
    return { clave: inferida, confianza: reglas.confianza.clave_maestro_inferida }
  }
  return null
}

/** RN1: el identificador tributario solo es seguro si el cliente es de Colombia y la etiqueta no es ambigua. */
function motivoIdentificador(etiqueta: string, pais: string): string | null {
  const esperado = identificadores[pais] ?? "identificador tributario local"
  if (pais !== reglas.pais_del_maestro) {
    return `identificador extranjero: el cliente (${pais}) pide ${esperado} y Periferia solo tiene NIT colombiano`
  }
  const ambiguas = reglas.etiquetas_ambiguas.map(normalizar)
  if (ambiguas.includes(normalizar(etiqueta))) {
    return `etiqueta ambigua: el equivalente en ${pais} es ${esperado}; confirmar que se refiere al NIT`
  }
  return null
}

/** Añade contexto a montos con moneda (por ejemplo, ingresos anuales en COP). */
function notaDeValor(clave: string, maestro: Maestro): string | null {
  if (!clave.endsWith(".valor")) return null
  const base = clave.slice(0, -".valor".length)
  const moneda = valorEnMaestro(maestro, `${base}.moneda`)
  const ano = valorEnMaestro(maestro, `${base}.ano`)
  if (moneda === undefined) return null
  return `Valor en ${String(moneda)}${ano === undefined ? "" : ` del año ${String(ano)}`}`
}

function mapearCampo(campo: CampoSolicitado, ctx: Contexto): EntradaMapeo {
  const base = { etiqueta: campo.etiqueta, obligatorio: campo.obligatorio, ubicacion: campo.ubicacion }
  const vacia = { ...base, clave: null, valor: null, fuente: null, confianza: 0, nota: null }
  const encontrada = buscarClave(campo.etiqueta, ctx)
  if (!encontrada) {
    return { ...vacia, estado: "faltante", motivo: "No existe un dato equivalente en el glosario ni en el maestro" }
  }
  const valor = valorEnMaestro(ctx.maestro, encontrada.clave)
  if (valor === undefined) {
    return { ...vacia, clave: encontrada.clave, estado: "faltante", motivo: `El maestro no tiene valor para ${encontrada.clave}` }
  }
  const lleno: EntradaMapeo = {
    ...base,
    estado: "lleno",
    clave: encontrada.clave,
    valor,
    fuente: `maestro.json#${encontrada.clave}`,
    confianza: encontrada.confianza,
    motivo: null,
    nota: notaDeValor(encontrada.clave, ctx.maestro),
  }
  const motivoId =
    encontrada.clave === reglas.clave_identificador_tributario ? motivoIdentificador(campo.etiqueta, ctx.pais) : null
  if (motivoId) return { ...lleno, estado: "requiere_confirmacion", motivo: motivoId }
  if (encontrada.confianza < reglas.umbral_confianza) {
    return { ...lleno, estado: "requiere_confirmacion", motivo: `mapeo inferido con confianza ${encontrada.confianza}` }
  }
  return lleno
}

export function mapear(
  caso: string,
  pais: string,
  campos: CampoSolicitado[],
  glosario: Record<string, string>,
  maestro: Maestro,
): Mapeo {
  const glosarioNormalizado = new Map(Object.entries(glosario).map(([k, v]) => [normalizar(k), v]))
  const ctx: Contexto = { pais, glosario, glosarioNormalizado, maestro }
  return { caso, pais, entradas: campos.map((campo) => mapearCampo(campo, ctx)) }
}

/** Texto del valor para formularios y resúmenes. */
export function textoValor(valor: Valor | null): string {
  return valor === null ? "" : String(valor)
}

/**
 * Vista del mapeo que se devuelve al modelo. El número de cuenta se enmascara: el modelo no lo
 * necesita para orquestar y así nunca puede repetirlo en el chat o en un correo.
 */
export function vistaParaModelo(entrada: EntradaMapeo): Record<string, unknown> {
  const sensible = entrada.clave === "banco.numero_cuenta" && entrada.valor !== null
  const valor = sensible ? `****${textoValor(entrada.valor).slice(-4)}` : entrada.valor
  return {
    etiqueta: entrada.etiqueta,
    clave: entrada.clave,
    valor,
    fuente: entrada.fuente,
    confianza: entrada.confianza,
    ...(entrada.obligatorio === null ? {} : { obligatorio: entrada.obligatorio }),
    ...(entrada.motivo ? { motivo: entrada.motivo } : {}),
    ...(entrada.nota ? { nota: entrada.nota } : {}),
    ...(sensible ? { enmascarado: true } : {}),
  }
}
