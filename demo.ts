// Verificación sin modelo: ejecuta las herramientas sobre todos los casos de fixtures/reto-01/casos/
// y muestra un resumen por caso. No necesita ninguna clave de proveedor.
//   bun run demo.ts        (FECHA_REFERENCIA=2026-09-15 bun run demo.ts para fijar la fecha)
import { readdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { fechaReferencia } from "./src/config.ts"
import { ejecutarHerramienta } from "./src/tools/registro.ts"
import type { ContextoHerramienta } from "./src/tools/tipos.ts"

const directory = import.meta.dir
const ctx: ContextoHerramienta = { directory, sessionId: "demo" }

interface Respuesta {
  ok: boolean
  data?: Record<string, unknown>
  error?: string
}

async function llamar(nombre: string, args: Record<string, unknown>): Promise<Respuesta> {
  const { resultado } = await ejecutarHerramienta(nombre, args, ctx)
  return JSON.parse(resultado) as Respuesta
}

function etiquetas(lista: unknown): string {
  const items = Array.isArray(lista) ? (lista as { etiqueta: string }[]).map((e) => e.etiqueta) : []
  return items.length > 0 ? items.join(", ") : "ninguno"
}

async function procesar(caso: string): Promise<void> {
  console.log(`\n━━━ ${caso} ━━━`)
  const lectura = await llamar("proveedor_leer_solicitud", { caso })
  if (!lectura.ok || !lectura.data) return console.log(`  ✗ ${lectura.error}`)
  const { pais, cliente, formato, campos } = lectura.data as { pais: string; cliente: string; formato: string; campos: { etiqueta: string }[] }
  console.log(`  Cliente: ${cliente} (${pais}) · formato: ${formato} · ${campos.length} campos`)

  const mapeo = await llamar("proveedor_mapear_campos", { caso, campos: campos.map((c) => c.etiqueta) })
  if (!mapeo.ok || !mapeo.data) return console.log(`  ✗ ${mapeo.error}`)
  console.log(`  Mapeo: ${JSON.stringify(mapeo.data.resumen)}`)
  console.log(`    Faltantes: ${etiquetas(mapeo.data.faltantes)}`)
  console.log(`    Por confirmar: ${etiquetas(mapeo.data.requiere_confirmacion)}`)

  const formulario = await llamar("proveedor_generar_formulario", { caso })
  console.log(`  Formulario: ${formulario.ok ? `${String(formulario.data?.ruta)}${formulario.data?.soportado === false ? " (formato no soportado: valores para copiar)" : ""}` : `✗ ${formulario.error}`}`)

  const paquete = await llamar("proveedor_armar_paquete", { caso })
  if (!paquete.ok || !paquete.data) return console.log(`  ✗ ${paquete.error}`)
  const checklist = paquete.data.checklist as { bloqueos: string[] }
  console.log(`  Paquete: ${String(paquete.data.ruta)} · listo_para_firma=${String(paquete.data.listo_para_firma)}`)
  for (const bloqueo of checklist.bloqueos) console.log(`    ⛔ ${bloqueo}`)

  const envio = await llamar("proveedor_simular_envio", { caso, confirmado: false })
  console.log(`  Envío sin confirmación: ${envio.ok ? "✗ se envió (no debería)" : `rechazado ✓ (${envio.error})`}`)
}

async function main(): Promise<void> {
  await rm(join(directory, "out"), { recursive: true, force: true })
  console.log(`Demo sin modelo · fecha de referencia para vigencias: ${fechaReferencia()}`)
  const casos = (await readdir(join(directory, "fixtures", "reto-01", "casos"), { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
  for (const caso of casos) await procesar(caso)
  const inexistente = await llamar("proveedor_leer_solicitud", { caso: "caso-inexistente" })
  console.log(`\nCaso inexistente: ${inexistente.ok ? "✗" : `error claro ✓ (${inexistente.error})`}`)
  const traversal = await llamar("proveedor_leer_solicitud", { caso: "../../.env" })
  console.log(`Ruta maliciosa: ${traversal.ok ? "✗" : `bloqueada ✓ (${traversal.error})`}`)
}

await main()
