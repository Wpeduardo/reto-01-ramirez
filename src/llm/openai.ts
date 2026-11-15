// Implementación del adaptador para la Chat Completions API de OpenAI (sin SDK, solo fetch).
import { type AdaptadorLLM, type Bloque, ErrorLLM, type Mensaje, type PeticionModelo, postJson, type RespuestaModelo } from "./adapter.ts"

interface LlamadaOpenAI {
  id: string
  function: { name: string; arguments: string }
  /** Gemini adjunta aquí la firma de razonamiento (thought_signature), que hay que devolver tal cual. */
  extra_content?: unknown
}

interface RespuestaOpenAI {
  choices?: { message?: { content?: string | null; tool_calls?: LlamadaOpenAI[] }; finish_reason?: string }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

function aOpenAI(m: Mensaje): Record<string, unknown>[] {
  if (m.rol === "usuario") {
    const resultados = m.bloques.flatMap((b) =>
      b.tipo === "resultado" ? [{ role: "tool", tool_call_id: b.id, ...(b.nombre ? { name: b.nombre } : {}), content: b.contenido }] : [],
    )
    const texto = m.bloques.flatMap((b) => (b.tipo === "texto" ? [b.texto] : [])).join("\n")
    return [...resultados, ...(texto ? [{ role: "user", content: texto }] : [])]
  }
  const texto = m.bloques.flatMap((b) => (b.tipo === "texto" ? [b.texto] : [])).join("\n")
  const llamadas = m.bloques.flatMap((b) =>
    b.tipo === "herramienta"
      ? [{ id: b.id, type: "function", function: { name: b.nombre, arguments: JSON.stringify(b.args ?? {}) }, ...(b.extra ? { extra_content: b.extra } : {}) }]
      : [],
  )
  return [{ role: "assistant", content: texto || null, ...(llamadas.length > 0 ? { tool_calls: llamadas } : {}) }]
}

function argumentos(texto: string): unknown {
  try {
    return JSON.parse(texto)
  } catch {
    return { argumentos_invalidos: texto }
  }
}

/** Algunas APIs compatibles (por ejemplo, Gemini) no aceptan `additionalProperties` en los esquemas. */
function esquemaCompatible(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(esquemaCompatible)
  if (typeof valor !== "object" || valor === null) return valor
  return Object.fromEntries(
    Object.entries(valor).filter(([k]) => k !== "additionalProperties").map(([k, v]) => [k, esquemaCompatible(v)]),
  )
}

export function crearOpenAI(apiKey: string, modelo: string, maxTokens: number, timeoutMs: number, baseUrl: string): AdaptadorLLM {
  const esOficial = baseUrl === "https://api.openai.com/v1"
  return {
    proveedor: "openai",
    modelo,
    async enviar(p: PeticionModelo): Promise<RespuestaModelo> {
      if (!apiKey && esOficial) throw new ErrorLLM("Falta OPENAI_API_KEY en las variables de entorno del backend")
      const crudo = (await postJson(
        `${baseUrl}/chat/completions`,
        apiKey ? { authorization: `Bearer ${apiKey}` } : {},
        {
          model: modelo,
          // La API oficial usa max_completion_tokens; las compatibles (Gemini, Ollama…) usan max_tokens.
          ...(esOficial ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens }),
          messages: [{ role: "system", content: p.sistema }, ...p.mensajes.flatMap(aOpenAI)],
          tools: p.herramientas.map((h) => ({
            type: "function",
            function: { name: h.name, description: h.description, parameters: esOficial ? h.input_schema : esquemaCompatible(h.input_schema) },
          })),
        },
        timeoutMs,
      )) as RespuestaOpenAI
      const eleccion = crudo.choices?.[0]
      const mensaje = eleccion?.message
      const bloques: Bloque[] = [
        ...(mensaje?.content ? [{ tipo: "texto" as const, texto: mensaje.content }] : []),
        ...(mensaje?.tool_calls ?? []).map((l) => ({
          tipo: "herramienta" as const,
          id: l.id,
          nombre: l.function.name,
          args: argumentos(l.function.arguments),
          ...(l.extra_content ? { extra: l.extra_content } : {}),
        })),
      ]
      const fin = eleccion?.finish_reason === "tool_calls" ? "herramientas" : eleccion?.finish_reason === "length" ? "limite" : "fin"
      return { bloques, fin, uso: { entrada: crudo.usage?.prompt_tokens ?? 0, salida: crudo.usage?.completion_tokens ?? 0 } }
    },
  }
}
