// Evaluación de soportes (RN3) y documentos del paquete para firma: checklist y borrador de correo.
import type { Maestro, Solicitud, Soporte } from "./datos.ts"
import { type Mapeo, textoValor, valorEnMaestro } from "./mapeo.ts"

export type EstadoSoporte = "vigente" | "vencido" | "ausente"

export interface SoporteEvaluado {
  tipo: string
  estado: EstadoSoporte
  archivo: string | null
  vigencia_hasta: string | null
  descripcion: string | null
}

export interface Checklist {
  fecha_referencia: string
  soportes: SoporteEvaluado[]
  campos_faltantes: string[]
  campos_por_confirmar: string[]
  bloqueos: string[]
}

/** Un soporte con vigencia anterior a la fecha de referencia está vencido. Sin vigencia, no vence. */
export function evaluarSoportes(exigidos: string[], indice: Soporte[], fecha: string): SoporteEvaluado[] {
  return exigidos.map((tipo) => {
    const soporte = indice.find((s) => s.tipo === tipo)
    if (!soporte) return { tipo, estado: "ausente", archivo: null, vigencia_hasta: null, descripcion: null }
    const vencido = soporte.vigencia_hasta !== null && soporte.vigencia_hasta < fecha
    return {
      tipo,
      estado: vencido ? "vencido" : "vigente",
      archivo: soporte.archivo,
      vigencia_hasta: soporte.vigencia_hasta,
      descripcion: soporte.descripcion,
    }
  })
}

export function construirChecklist(mapeo: Mapeo, soportes: SoporteEvaluado[], fecha: string): Checklist {
  const bloqueos = soportes
    .filter((s) => s.estado !== "vigente")
    .map((s) =>
      s.estado === "vencido"
        ? `Soporte vencido: ${s.tipo} (vigente hasta ${s.vigencia_hasta ?? "?"})`
        : `Soporte exigido ausente en el repositorio: ${s.tipo}`,
    )
  return {
    fecha_referencia: fecha,
    soportes,
    campos_faltantes: mapeo.entradas.filter((e) => e.estado === "faltante").map((e) => e.etiqueta),
    campos_por_confirmar: mapeo.entradas.filter((e) => e.estado === "requiere_confirmacion").map((e) => e.etiqueta),
    bloqueos,
  }
}

const ICONOS: Record<EstadoSoporte, string> = { vigente: "✅ Presente", vencido: "⛔ Vencido", ausente: "❌ Ausente" }

function lista(items: string[], vacio: string): string[] {
  return items.length > 0 ? items.map((i) => `- ${i}`) : [`- ${vacio}`]
}

export function checklistMarkdown(c: Checklist, solicitud: Solicitud, mapeo: Mapeo): string {
  const listo = c.bloqueos.length === 0
  const confirmar = mapeo.entradas
    .filter((e) => e.estado === "requiere_confirmacion")
    .map((e) => `${e.etiqueta}: ${e.motivo ?? ""}`)
  return [
    `# Checklist · ${solicitud.cliente} (${solicitud.id})`,
    "",
    `**Estado:** ${listo ? "LISTO PARA FIRMA" : "NO LISTO PARA FIRMA"} · Fecha de referencia: ${c.fecha_referencia}`,
    "",
    "## Soportes exigidos",
    "",
    "| Soporte | Estado | Archivo | Vigente hasta |",
    "|---|---|---|---|",
    ...c.soportes.map(
      (s) => `| ${s.tipo} | ${ICONOS[s.estado]} | ${s.archivo ?? "—"} | ${s.estado === "ausente" ? "—" : (s.vigencia_hasta ?? "sin vencimiento")} |`,
    ),
    "",
    "## Bloqueos para la firma",
    "",
    ...lista(c.bloqueos, "Ninguno"),
    "",
    "## Campos faltantes (no bloquean, deben completarse a mano)",
    "",
    ...lista(c.campos_faltantes, "Ninguno"),
    "",
    "## Campos que requieren confirmación",
    "",
    ...lista(confirmar, "Ninguno"),
    "",
  ].join("\n")
}

/** RN2: el borrador nunca incluye datos bancarios. Se verifica además que ningún valor bancario se cuele. */
export function borradorCorreo(solicitud: Solicitud, maestro: Maestro, soportes: SoporteEvaluado[], adjuntoFormulario: string): string {
  const texto = (clave: string): string => textoValor(valorEnMaestro(maestro, clave) ?? null)
  const adjuntos = [adjuntoFormulario, ...soportes.filter((s) => s.archivo).map((s) => `${s.descripcion ?? s.tipo} (${s.archivo})`)]
  const borrador = [
    "<!-- BORRADOR: no enviar hasta que el representante legal firme el formulario. -->",
    "",
    `**Para:** ${solicitud.de}`,
    `**Asunto:** Re: ${solicitud.asunto}`,
    "",
    "Estimados,",
    "",
    `En atención a su solicitud, remitimos el formulario de registro como proveedor de ${texto("razon_social")}, firmado por nuestro representante legal, ${texto("representante_legal.nombre")}, junto con los soportes solicitados:`,
    "",
    ...adjuntos.map((a) => `- ${a}`),
    "",
    "Quedamos atentos a cualquier información adicional.",
    "",
    "Cordialmente,",
    "",
    texto("contacto_comercial.nombre"),
    `${texto("contacto_comercial.cargo")} · ${texto("razon_social")}`,
    `${texto("contacto_comercial.email")} · ${texto("contacto_comercial.telefono")}`,
    "",
  ].join("\n")
  verificarSinDatosBancarios(borrador, maestro)
  return borrador
}

function verificarSinDatosBancarios(texto: string, maestro: Maestro): void {
  const banco = maestro.banco
  if (typeof banco !== "object" || banco === null) return
  for (const [campo, valor] of Object.entries(banco)) {
    const sensible = ["numero_cuenta", "swift"].includes(campo)
    if (sensible && typeof valor === "string" && texto.includes(valor)) {
      throw new Error("El borrador de correo contiene datos bancarios y no se generó (RN2)")
    }
  }
}
