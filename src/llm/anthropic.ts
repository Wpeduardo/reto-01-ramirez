// Implementación del adaptador para la Messages API de Anthropic (sin SDK, solo fetch).
import { type AdaptadorLLM, type Bloque, ErrorLLM, type Mensaje, type PeticionModelo, postJson, type RespuestaModelo } from "./adapter.ts"

interface BloqueAnthropic {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
}

interface RespuestaAnthropic {
  content?: BloqueAnthropic[]
  stop_reason?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

function aAnthropic(m: Mensaje): Record<string, unknown> {
  const content = m.bloques.map((b) => {
    if (b.tipo === "texto") return { type: "text", text: b.texto }
    if (b.tipo === "herramienta") return { type: "tool_use", id: b.id, name: b.nombre, input: b.args ?? {} }
    return { type: "tool_result", tool_use_id: b.id, content: b.contenido, is_error: b.error }
  })
  return { role: m.rol === "usuario" ? "user" : "assistant", content }
}

function desdeAnthropic(b: BloqueAnthropic): Bloque | null {
  if (b.type === "text" && typeof b.text === "string") return { tipo: "texto", texto: b.text }
  if (b.type === "tool_use" && b.id && b.name) return { tipo: "herramienta", id: b.id, nombre: b.name, args: b.input }
  return null
}

export function crearAnthropic(apiKey: string, modelo: string, maxTokens: number, timeoutMs: number, workspaceId = ""): AdaptadorLLM {
  const cabeceras: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    "anthropic-version": "2023-06-01",
    ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}),
  }
  return {
    proveedor: "anthropic",
    modelo,
    async enviar(p: PeticionModelo): Promise<RespuestaModelo> {
      if (!apiKey) throw new ErrorLLM("Falta ANTHROPIC_API_KEY en las variables de entorno del backend")
      const crudo = (await postJson(
        "https://api.anthropic.com/v1/messages",
        cabeceras,
        {
          model: modelo,
          max_tokens: maxTokens,
          system: p.sistema,
          messages: p.mensajes.map(aAnthropic),
          tools: p.herramientas,
        },
        timeoutMs,
      )) as RespuestaAnthropic
      const bloques = (crudo.content ?? []).map(desdeAnthropic).filter((b): b is Bloque => b !== null)
      const fin = crudo.stop_reason === "tool_use" ? "herramientas" : crudo.stop_reason === "max_tokens" ? "limite" : "fin"
      return { bloques, fin, uso: { entrada: crudo.usage?.input_tokens ?? 0, salida: crudo.usage?.output_tokens ?? 0 } }
    },
  }
}
