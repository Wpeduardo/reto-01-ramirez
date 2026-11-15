// Configuración leída de variables de entorno. Ningún valor secreto se registra ni se expone por la API.

function entero(nombre: string, porDefecto: number): number {
  const valor = Number(process.env[nombre])
  return Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : porDefecto
}

export type Proveedor = "anthropic" | "openai"

export interface Config {
  proveedor: Proveedor
  modelo: string
  apiKey: string
  /** Solo si la clave de Anthropic no está asociada a un workspace. */
  anthropicWorkspaceId: string
  /** Base de una API compatible con OpenAI (OpenAI, Azure, Ollama, LM Studio…). */
  openaiBaseUrl: string
  maxIteraciones: number
  maxTokensSesion: number
  maxTokensRespuesta: number
  timeoutMs: number
  puerto: number
  accessKey: string
  limitePorMinuto: number
}

export function leerConfig(): Config {
  const proveedor: Proveedor = process.env.LLM_PROVIDER === "openai" ? "openai" : "anthropic"
  const modeloPorDefecto = proveedor === "openai" ? "gpt-4.1-mini" : "claude-sonnet-5-5"
  const apiKey =
    proveedor === "openai" ? (process.env.OPENAI_API_KEY ?? "") : (process.env.ANTHROPIC_API_KEY ?? "")
  return {
    proveedor,
    modelo: process.env.LLM_MODEL || modeloPorDefecto,
    apiKey,
    anthropicWorkspaceId: process.env.ANTHROPIC_WORKSPACE_ID ?? "",
    openaiBaseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
    maxIteraciones: entero("MAX_ITERACIONES", 25),
    maxTokensSesion: entero("MAX_TOKENS_SESION", 200_000),
    maxTokensRespuesta: entero("MAX_TOKENS_RESPUESTA", 2_048),
    timeoutMs: entero("LLM_TIMEOUT_MS", 60_000),
    puerto: entero("PORT", 3000),
    accessKey: process.env.ACCESS_KEY ?? "",
    limitePorMinuto: entero("LIMITE_MENSAJES_POR_MINUTO", 20),
  }
}

/** Fecha de referencia (YYYY-MM-DD) para evaluar vigencias. Configurable para que demo.ts sea determinista. */
export function fechaReferencia(): string {
  const configurada = process.env.FECHA_REFERENCIA ?? ""
  if (/^\d{4}-\d{2}-\d{2}$/.test(configurada)) return configurada
  return new Date().toISOString().slice(0, 10)
}
