// Pruebas del ciclo del agente con un modelo simulado (sin clave ni red).
import { beforeEach, describe, expect, test } from "bun:test"
import { access, rm } from "node:fs/promises"
import { join } from "node:path"
import { cargarSistema, type Dependencias, procesarTurno } from "../src/agent/ciclo.ts"
import { esConfirmacion } from "../src/agent/confirmacion.ts"
import { obtenerOCrear } from "../src/agent/sesiones.ts"
import { type AdaptadorLLM, type Bloque, ErrorLLM, type Mensaje, type RespuestaModelo } from "../src/llm/adapter.ts"

process.env.FECHA_REFERENCIA = "2026-09-15"
const directory = join(import.meta.dir, "..")
const CASO = "ec-corp-andina"

type Paso = (mensajes: Mensaje[]) => RespuestaModelo

function herramienta(nombre: string, args: unknown): RespuestaModelo {
  return { bloques: [{ tipo: "herramienta", id: `id-${nombre}-${Math.random()}`, nombre, args }], fin: "herramientas", uso: { entrada: 10, salida: 5 } }
}

function texto(t: string): RespuestaModelo {
  return { bloques: [{ tipo: "texto", texto: t }], fin: "fin", uso: { entrada: 10, salida: 5 } }
}

/** Último resultado de herramienta recibido por el modelo, ya parseado. */
function ultimoResultado(mensajes: Mensaje[]): { ok: boolean; data: Record<string, unknown> } {
  const bloques: Bloque[] = mensajes.at(-1)?.bloques ?? []
  const r = bloques.find((b) => b.tipo === "resultado")
  return JSON.parse(r && r.tipo === "resultado" ? r.contenido : "{}")
}

/** Modelo simulado que reproduce un guion de pasos. */
function modeloSimulado(pasos: Paso[]): AdaptadorLLM {
  let i = 0
  return {
    proveedor: "simulado",
    modelo: "guion",
    async enviar({ mensajes }) {
      const paso = pasos[i++]
      if (!paso) throw new Error("El guion se quedó sin pasos")
      return paso(mensajes)
    },
  }
}

async function deps(adaptador: AdaptadorLLM, maxIteraciones = 25): Promise<Dependencias> {
  return { adaptador, sistema: await cargarSistema(directory), directory, maxIteraciones, maxTokensSesion: 100_000 }
}

async function existe(ruta: string): Promise<boolean> {
  return access(ruta).then(() => true, () => false)
}

const rutaEnvio = join(directory, "out", CASO, "ENVIO-SIMULADO.md")

beforeEach(async () => {
  await rm(join(directory, "out"), { recursive: true, force: true })
})

describe("confirmación humana (CA3 / RN4)", () => {
  test("detecta confirmaciones y negaciones", () => {
    expect(esConfirmacion("envía")).toBe(true)
    expect(esConfirmacion("Sí, confirmo el envío")).toBe(true)
    expect(esConfirmacion("No envíes nada todavía")).toBe(false)
    expect(esConfirmacion("¿qué soportes faltan?")).toBe(false)
  })

  test("el modelo no puede enviar sin confirmación aunque pase confirmado=true", async () => {
    const sesion = await obtenerOCrear(directory, undefined)
    const turno1 = modeloSimulado([
      () => herramienta("proveedor_leer_solicitud", { caso: CASO }),
      (m) => herramienta("proveedor_mapear_campos", { caso: CASO, campos: (ultimoResultado(m).data.campos as { etiqueta: string }[]).map((c) => c.etiqueta) }),
      () => herramienta("proveedor_generar_formulario", { caso: CASO }),
      () => herramienta("proveedor_armar_paquete", { caso: CASO }),
      () => herramienta("proveedor_simular_envio", { caso: CASO, confirmado: true }),
      () => texto("Listo. ¿Confirmas que simule el envío?"),
    ])
    const r1 = await procesarTurno(sesion, `Procesa el caso "${CASO}". No envíes nada todavía.`, await deps(turno1))
    expect(r1.toolCalls.map((t) => t.nombre)).toEqual([
      "proveedor_leer_solicitud",
      "proveedor_mapear_campos",
      "proveedor_generar_formulario",
      "proveedor_armar_paquete",
      "proveedor_simular_envio",
    ])
    expect(r1.toolCalls.at(-1)?.ok).toBe(false)
    expect(r1.needsConfirmation).toBe(true)
    expect(await existe(rutaEnvio)).toBe(false)

    const turno2 = modeloSimulado([() => herramienta("proveedor_simular_envio", { caso: CASO, confirmado: false }), () => texto("Envío simulado.")])
    const r2 = await procesarTurno(sesion, "envía", await deps(turno2))
    expect(r2.toolCalls[0]?.ok).toBe(true)
    expect(r2.needsConfirmation).toBe(false)
    expect(await existe(rutaEnvio)).toBe(true)
  })

  test("sin una acción pendiente, 'envía' no autoriza el envío", async () => {
    const sesion = await obtenerOCrear(directory, undefined)
    const guion = modeloSimulado([() => herramienta("proveedor_simular_envio", { caso: CASO, confirmado: true }), () => texto("Necesito confirmación.")])
    const r = await procesarTurno(sesion, "envía", await deps(guion))
    expect(r.toolCalls[0]?.ok).toBe(false)
    expect(await existe(rutaEnvio)).toBe(false)
  })
})

describe("robustez del ciclo (CA1 / CA5)", () => {
  test("respeta el tope de iteraciones por turno", async () => {
    const sesion = await obtenerOCrear(directory, undefined)
    const infinito = modeloSimulado(Array.from({ length: 10 }, () => () => herramienta("proveedor_leer_solicitud", { caso: CASO })))
    const r = await procesarTurno(sesion, "procesa", await deps(infinito, 3))
    expect(r.toolCalls).toHaveLength(3)
    expect(r.reply).toContain("tope de 3 pasos")
  })

  test("un error del proveedor se muestra en claro y la sesión sigue viva", async () => {
    const sesion = await obtenerOCrear(directory, undefined)
    const caido = modeloSimulado([() => { throw new ErrorLLM("El modelo no respondió en 60 s (timeout)") }])
    const r = await procesarTurno(sesion, "hola", await deps(caido))
    expect(r.error).toContain("timeout")
    expect(sesion.mensajes).toHaveLength(0)
    const r2 = await procesarTurno(sesion, "hola de nuevo", await deps(modeloSimulado([() => texto("Hola")])))
    expect(r2.reply).toBe("Hola")
  })

  test("argumentos inválidos vuelven al modelo como error, sin romper el turno", async () => {
    const sesion = await obtenerOCrear(directory, undefined)
    const guion = modeloSimulado([() => herramienta("proveedor_mapear_campos", { caso: CASO }), () => texto("Faltó la lista de campos.")])
    const r = await procesarTurno(sesion, "mapea", await deps(guion))
    expect(r.toolCalls[0]?.ok).toBe(false)
    expect(r.toolCalls[0]?.resumen).toContain("Argumentos inválidos")
    expect(r.reply).toBe("Faltó la lista de campos.")
  })
})
