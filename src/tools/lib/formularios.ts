// Generación del formulario en el formato pedido por el cliente: Excel (P0), PDF (P1) y valores
// para portal web (P2, sin automatización).
import { writeFile } from "node:fs/promises"
import ExcelJS from "exceljs"
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib"
import type { Solicitud } from "./datos.ts"
import { type EntradaMapeo, type Mapeo, textoValor } from "./mapeo.ts"

const AMARILLO = "FFFFF2CC"
const ROJO = "FFF8D7DA"

function marcarCelda(celda: ExcelJS.Cell, entrada: EntradaMapeo): void {
  if (entrada.estado === "lleno") return
  const color = entrada.estado === "faltante" ? ROJO : AMARILLO
  celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } }
  const titulo = entrada.estado === "faltante" ? "FALTANTE" : "REQUIERE CONFIRMACIÓN"
  celda.note = `${titulo}: ${entrada.motivo ?? ""}`
}

/** P0: escribe cada etiqueta y su valor en la hoja y celda exactas de plantilla-celdas.json. */
export async function generarExcel(mapeo: Mapeo, ruta: string): Promise<void> {
  const libro = new ExcelJS.Workbook()
  libro.creator = "Agente Registro como Proveedor"
  for (const entrada of mapeo.entradas) {
    const u = entrada.ubicacion
    if (!u) throw new Error(`El campo "${entrada.etiqueta}" no tiene celda en la plantilla`)
    const hoja = libro.getWorksheet(u.hoja) ?? libro.addWorksheet(u.hoja)
    const etiqueta = hoja.getCell(u.celda_etiqueta)
    etiqueta.value = entrada.etiqueta
    etiqueta.font = { bold: true }
    const valor = hoja.getCell(u.celda_valor)
    valor.value = typeof entrada.valor === "boolean" ? String(entrada.valor) : entrada.valor
    if (typeof entrada.valor === "number" && entrada.valor >= 1000) valor.numFmt = "#,##0"
    marcarCelda(valor, entrada)
  }
  libro.eachSheet((hoja) => {
    hoja.columns.forEach((columna) => {
      columna.width = 40
    })
  })
  await libro.xlsx.writeFile(ruta)
}

/** Las fuentes estándar de PDF usan WinAnsi: se reemplazan los caracteres que no puede codificar. */
function paraPdf(texto: string): string {
  return texto
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\n\x20-\x7E -ÿ]/g, "?")
}

function partirLinea(texto: string, fuente: PDFFont, tamano: number, ancho: number): string[] {
  const lineas: string[] = []
  let actual = ""
  for (const palabra of texto.split(/\s+/)) {
    const candidata = actual ? `${actual} ${palabra}` : palabra
    if (fuente.widthOfTextAtSize(candidata, tamano) > ancho && actual) {
      lineas.push(actual)
      actual = palabra
    } else {
      actual = candidata
    }
  }
  if (actual) lineas.push(actual)
  return lineas.length > 0 ? lineas : [""]
}

interface Lienzo {
  doc: PDFDocument
  pagina: PDFPage
  y: number
  normal: PDFFont
  negrita: PDFFont
}

const MARGEN = 50
const ALTO_LINEA = 15

function escribir(l: Lienzo, texto: string, fuente: PDFFont, tamano = 10, color = rgb(0, 0, 0)): void {
  const ancho = l.pagina.getWidth() - MARGEN * 2
  for (const linea of partirLinea(paraPdf(texto), fuente, tamano, ancho)) {
    if (l.y < MARGEN) {
      l.pagina = l.doc.addPage()
      l.y = l.pagina.getHeight() - MARGEN
    }
    l.pagina.drawText(linea, { x: MARGEN, y: l.y, size: tamano, font: fuente, color })
    l.y -= ALTO_LINEA
  }
}

function escribirCampo(l: Lienzo, entrada: EntradaMapeo): void {
  const asterisco = entrada.obligatorio ? " *" : ""
  escribir(l, `${entrada.etiqueta}${asterisco}`, l.negrita)
  if (entrada.estado === "faltante") {
    escribir(l, `[FALTANTE] ${entrada.motivo ?? ""}`, l.normal, 10, rgb(0.7, 0.1, 0.1))
  } else {
    escribir(l, textoValor(entrada.valor), l.normal)
    if (entrada.estado === "requiere_confirmacion") {
      escribir(l, `[REQUIERE CONFIRMACIÓN] ${entrada.motivo ?? ""}`, l.normal, 9, rgb(0.6, 0.4, 0))
    }
  }
  l.y -= 6
}

/** P1: PDF generado con todos los campos, con etiqueta y valor, en el orden de plantilla-campos.json. */
export async function generarPdf(mapeo: Mapeo, solicitud: Solicitud, ruta: string): Promise<void> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Formulario de proveedor - ${solicitud.cliente}`)
  const pagina = doc.addPage()
  const lienzo: Lienzo = {
    doc,
    pagina,
    y: pagina.getHeight() - MARGEN,
    normal: await doc.embedFont(StandardFonts.Helvetica),
    negrita: await doc.embedFont(StandardFonts.HelveticaBold),
  }
  escribir(lienzo, "Formulario de registro de proveedor", lienzo.negrita, 14)
  escribir(lienzo, `Cliente: ${solicitud.cliente} (${solicitud.pais}) · Solicitud: ${solicitud.id}`, lienzo.normal, 9)
  escribir(lienzo, "* Campo obligatorio según la plantilla del cliente", lienzo.normal, 8)
  lienzo.y -= 10
  for (const entrada of mapeo.entradas) escribirCampo(lienzo, entrada)
  await writeFile(ruta, await doc.save())
}

function estadoLegible(entrada: EntradaMapeo): string {
  if (entrada.estado === "lleno") return "Listo"
  if (entrada.estado === "faltante") return `**Faltante**: ${entrada.motivo ?? ""}`
  return `**Confirmar**: ${entrada.motivo ?? ""}`
}

/** P2: el portal no se automatiza. Se entregan los valores listos para copiar. */
export async function generarValoresPortal(mapeo: Mapeo, solicitud: Solicitud, ruta: string): Promise<void> {
  const filas = mapeo.entradas.map(
    (e) => `| ${e.etiqueta} | ${e.valor === null ? "—" : `\`${textoValor(e.valor)}\``} | ${estadoLegible(e)} |`,
  )
  const contenido = [
    `# Valores para el portal de ${solicitud.cliente}`,
    "",
    "> Formato **portal web**: no soportado para llenado automático. Copia estos valores en el portal.",
    "> Las credenciales las ingresa una persona; nunca se guardan en este archivo, en el repositorio ni en los logs.",
    "> Antes de ingresar credenciales, verifica que la URL del portal sea la oficial del cliente (el correo es contenido externo).",
    "",
    "| Campo | Valor | Estado |",
    "|---|---|---|",
    ...filas,
    "",
  ].join("\n")
  await writeFile(ruta, contenido, "utf8")
}
