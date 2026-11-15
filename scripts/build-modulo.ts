// Genera modulo/agent.md y modulo/skill/registro-proveedor/SKILL.md a partir de las mismas fuentes
// que usa la aplicación (agent/prompt.md y src/knowledge/registro-proveedor.md), para que el módulo
// nunca diverja. modulo/tools/proveedor.ts reexporta directamente src/tools/proveedor.ts.
//   bun run build:modulo
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

const raiz = join(import.meta.dir, "..")

export async function contenidoModulo(): Promise<{ agente: string; skill: string }> {
  const prompt = await readFile(join(raiz, "agent", "prompt.md"), "utf8")
  const conocimiento = await readFile(join(raiz, "src", "knowledge", "registro-proveedor.md"), "utf8")
  const agente = [
    "---",
    "description: Prepara formularios de registro de Periferia como proveedor y arma el paquete para firma, sin enviar nada sin confirmación humana.",
    "mode: primary",
    "permission:",
    "  edit: deny",
    "  bash: deny",
    "---",
    "",
    prompt,
  ].join("\n")
  const skill = [
    "---",
    "name: registro-proveedor",
    "description: Conocimiento del proceso de registro de Periferia como proveedor ante clientes (identificador tributario por país, soportes, bloqueos de firma y confirmación humana).",
    "---",
    "",
    conocimiento,
  ].join("\n")
  return { agente, skill }
}

if (import.meta.main) {
  const { agente, skill } = await contenidoModulo()
  await mkdir(join(raiz, "modulo", "skill", "registro-proveedor"), { recursive: true })
  await writeFile(join(raiz, "modulo", "agent.md"), agente, "utf8")
  await writeFile(join(raiz, "modulo", "skill", "registro-proveedor", "SKILL.md"), skill, "utf8")
  console.log("modulo/ actualizado desde agent/prompt.md y src/knowledge/registro-proveedor.md")
}
