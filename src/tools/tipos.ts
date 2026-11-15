import type { z } from "zod"

/** Contexto que el ciclo del agente (o demo.ts) entrega a cada herramienta. */
export interface ContextoHerramienta {
  /** Raíz del proyecto. Todas las rutas se resuelven desde aquí. */
  directory: string
  sessionId: string
}

/** Contrato de herramienta del PRD (sección 6.2): description, args (zod) y execute que nunca lanza. */
export interface Herramienta<S extends z.ZodRawShape = z.ZodRawShape> {
  description: string
  args: S
  execute(args: z.infer<z.ZodObject<S>>, ctx: ContextoHerramienta): Promise<string>
}

export type Resultado<T> = { ok: true; data: T } | { ok: false; error: string }

export function exito<T>(data: T): string {
  return JSON.stringify({ ok: true, data } satisfies Resultado<T>)
}

export function fallo(error: string): string {
  return JSON.stringify({ ok: false, error } satisfies Resultado<never>)
}

/** Ayuda a tipar una herramienta sin perder la inferencia de sus argumentos. */
export function definirHerramienta<S extends z.ZodRawShape>(herramienta: Herramienta<S>): Herramienta<S> {
  return herramienta
}

/** Ejecuta el cuerpo de una herramienta y convierte cualquier excepción en { ok: false }. */
export async function sinExcepciones(cuerpo: () => Promise<string>): Promise<string> {
  try {
    return await cuerpo()
  } catch (error) {
    return fallo(error instanceof Error ? error.message : "Error inesperado en la herramienta")
  }
}
