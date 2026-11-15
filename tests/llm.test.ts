// Pruebas del adaptador compatible con OpenAI (Gemini): firma de razonamiento, reintentos y errores.
import { afterEach, expect, test } from "bun:test"
import { ErrorLLM, type Mensaje } from "../src/llm/adapter.ts"
import { crearOpenAI } from "../src/llm/openai.ts"

const fetchOriginal = globalThis.fetch
afterEach(() => {
  globalThis.fetch = fetchOriginal
})

function simularFetch(respuestas: Response[], cuerpos: unknown[] = []): void {
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    cuerpos.push(JSON.parse(String(init?.body)))
    const r = respuestas.shift()
    if (!r) throw new Error("sin respuestas")
    return r
  }) as typeof fetch
}

const usuario: Mensaje = { rol: "usuario", bloques: [{ tipo: "texto", texto: "hola" }] }
const gemini = () => crearOpenAI("k", "gemini", 4096, 5000, "https://generativelanguage.googleapis.com/v1beta/openai")

test("conserva la firma de Gemini y la devuelve en la siguiente petición", async () => {
  const firma = { google: { thought_signature: "sig-1" } }
  const cuerpos: unknown[] = []
  simularFetch([
    Response.json({ choices: [{ message: { tool_calls: [{ id: "c1", function: { name: "proveedor_leer_solicitud", arguments: "{}" }, extra_content: firma }] }, finish_reason: "tool_calls" }] }),
    Response.json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
  ], cuerpos)
  const r1 = await gemini().enviar({ sistema: "", mensajes: [usuario], herramientas: [] })
  const historial: Mensaje[] = [usuario, { rol: "asistente", bloques: r1.bloques }, { rol: "usuario", bloques: [{ tipo: "resultado", id: "c1", nombre: "proveedor_leer_solicitud", contenido: "{}", error: false }] }]
  await gemini().enviar({ sistema: "", mensajes: historial, herramientas: [] })
  const enviado = JSON.stringify(cuerpos[1])
  expect(enviado).toContain("sig-1")
  expect(enviado).toContain('"max_tokens":4096')
})

test("reintenta un 503 y muestra el motivo de los errores de Gemini", async () => {
  simularFetch([
    Response.json([{ error: { code: 503, message: "overloaded" } }], { status: 503 }),
    Response.json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
  ])
  const r = await gemini().enviar({ sistema: "", mensajes: [usuario], herramientas: [] })
  expect(r.bloques).toEqual([{ tipo: "texto", texto: "ok" }])

  simularFetch([Response.json([{ error: { code: 404, message: "This model is no longer available" } }], { status: 404 })])
  const error = await gemini().enviar({ sistema: "", mensajes: [usuario], herramientas: [] }).catch((e: unknown) => e)
  expect(error).toBeInstanceOf(ErrorLLM)
  expect((error as ErrorLLM).message).toContain("no longer available")
})
