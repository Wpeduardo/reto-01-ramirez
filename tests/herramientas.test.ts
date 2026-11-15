import { beforeAll, describe, expect, test } from "bun:test"
import { readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import ExcelJS from "exceljs"
import { definicionesParaModelo, ejecutarHerramienta } from "../src/tools/registro.ts"

process.env.FECHA_REFERENCIA = "2026-09-15"
const directory = join(import.meta.dir, "..")
const ctx = { directory, sessionId: "test-herramientas" }

async function llamar(nombre: string, args: Record<string, unknown>) {
  const { resultado } = await ejecutarHerramienta(nombre, args, ctx)
  return JSON.parse(resultado) as { ok: boolean; data: Record<string, unknown>; error?: string }
}

async function procesar(caso: string) {
  const lectura = await llamar("proveedor_leer_solicitud", { caso })
  const campos = (lectura.data.campos as { etiqueta: string }[]).map((c) => c.etiqueta)
  const mapeo = await llamar("proveedor_mapear_campos", { caso, campos })
  const formulario = await llamar("proveedor_generar_formulario", { caso })
  const paquete = await llamar("proveedor_armar_paquete", { caso })
  return { lectura, mapeo, formulario, paquete }
}

beforeAll(async () => {
  await rm(join(directory, "out"), { recursive: true, force: true })
})

describe("contrato de herramientas", () => {
  test("expone las cinco herramientas con el prefijo del archivo", () => {
    const nombres = definicionesParaModelo().map((d) => d.name).sort()
    expect(nombres).toEqual([
      "proveedor_armar_paquete",
      "proveedor_generar_formulario",
      "proveedor_leer_solicitud",
      "proveedor_mapear_campos",
      "proveedor_simular_envio",
    ])
  })

  test("rechaza rutas maliciosas y casos inexistentes sin lanzar", async () => {
    expect((await llamar("proveedor_leer_solicitud", { caso: "../../.env" })).ok).toBe(false)
    const inexistente = await llamar("proveedor_leer_solicitud", { caso: "no-existe" })
    expect(inexistente.ok).toBe(false)
    expect(inexistente.error).toContain("no existe")
  })
})

describe("co-industrias-delta (Excel)", () => {
  test("llena todas las celdas indicadas por la plantilla", async () => {
    const { mapeo, formulario } = await procesar("co-industrias-delta")
    expect(mapeo.data.resumen).toEqual({ total: 17, llenos: 17, faltantes: 0, requiere_confirmacion: 0 })
    const libro = new ExcelJS.Workbook()
    await libro.xlsx.readFile(join(directory, String(formulario.data.ruta)))
    expect(libro.getWorksheet("Datos Proveedor")?.getCell("C4").value).toBe("900123456")
    expect(libro.getWorksheet("Datos Proveedor")?.getCell("B4").value).toBe("NIT")
    expect(libro.getWorksheet("Datos Bancarios")?.getCell("C5").value).toBe("03100012345")
  })

  test("enmascara el número de cuenta en la respuesta al modelo", async () => {
    const { mapeo } = await procesar("co-industrias-delta")
    const cuenta = (mapeo.data.llenos as { clave: string; valor: string }[]).find((e) => e.clave === "banco.numero_cuenta")
    expect(cuenta?.valor).toBe("****2345")
  })

  test("el borrador de correo no contiene datos bancarios (RN2)", async () => {
    await procesar("co-industrias-delta")
    const borrador = await readFile(join(directory, "out/co-industrias-delta/paquete/borrador-correo.md"), "utf8")
    expect(borrador).not.toContain("03100012345")
    expect(borrador).not.toContain("COLOCOBM")
    expect(borrador).not.toContain("Bancolombia")
  })

  test("con soportes vigentes queda listo para firma", async () => {
    const { paquete } = await procesar("co-industrias-delta")
    expect(paquete.data.listo_para_firma).toBe(true)
  })
})

describe("ec-corp-andina (PDF)", () => {
  test("marca RUC como identificador extranjero y el contribuyente especial como faltante", async () => {
    const { mapeo, formulario } = await procesar("ec-corp-andina")
    const porConfirmar = mapeo.data.requiere_confirmacion as { etiqueta: string; motivo: string }[]
    expect(porConfirmar.map((e) => e.etiqueta)).toEqual(["RUC"])
    expect(porConfirmar[0]?.motivo).toContain("identificador extranjero")
    expect((mapeo.data.faltantes as { etiqueta: string }[]).map((e) => e.etiqueta)).toEqual(["Número de contribuyente especial"])
    const pdf = await readFile(join(directory, String(formulario.data.ruta)))
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-")
  })

  test("un soporte exigido ausente bloquea la firma", async () => {
    const { paquete } = await procesar("ec-corp-andina")
    expect(paquete.data.listo_para_firma).toBe(false)
    const bloqueos = (paquete.data.checklist as { bloqueos: string[] }).bloqueos
    expect(bloqueos.some((b) => b.includes("certificado_cumplimiento_tributario"))).toBe(true)
  })
})

describe("hn-agroexport-sula y pa-logistica-istmo", () => {
  test("parafiscales vencidos bloquean la firma; referencias comerciales es faltante", async () => {
    const { mapeo, paquete } = await procesar("hn-agroexport-sula")
    expect((mapeo.data.faltantes as { etiqueta: string }[]).map((e) => e.etiqueta)).toEqual(["Referencias comerciales"])
    const bloqueos = (paquete.data.checklist as { bloqueos: string[] }).bloqueos
    expect(bloqueos).toEqual(["Soporte vencido: parafiscales (vigente hasta 2026-08-31)"])
  })

  test("el portal responde formato no soportado y genera valores para copiar", async () => {
    const { formulario } = await procesar("pa-logistica-istmo")
    expect(formulario.data.soportado).toBe(false)
    expect(String(formulario.data.mensaje)).toContain("formato no soportado")
    expect(formulario.data.ruta).toBe("out/pa-logistica-istmo/valores-portal.md")
  })
})

describe("simular envío", () => {
  test("sin confirmación devuelve el error del contrato", async () => {
    await procesar("co-industrias-delta")
    const envio = await llamar("proveedor_simular_envio", { caso: "co-industrias-delta", confirmado: false })
    expect(envio).toEqual({ ok: false, error: "requiere confirmación explícita" } as never)
  })
})
