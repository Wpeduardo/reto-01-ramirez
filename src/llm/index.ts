import type { Config } from "../config.ts"
import type { AdaptadorLLM } from "./adapter.ts"
import { crearAnthropic } from "./anthropic.ts"
import { crearOpenAI } from "./openai.ts"

/** Elige la implementación según LLM_PROVIDER. Es el único punto que conoce a los proveedores concretos. */
export function crearAdaptador(config: Config): AdaptadorLLM {
  if (config.proveedor === "openai") {
    return crearOpenAI(config.apiKey, config.modelo, config.maxTokensRespuesta, config.timeoutMs, config.openaiBaseUrl)
  }
  return crearAnthropic(config.apiKey, config.modelo, config.maxTokensRespuesta, config.timeoutMs, config.anthropicWorkspaceId)
}
