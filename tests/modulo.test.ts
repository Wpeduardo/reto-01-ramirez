import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import * as moduloTools from "../modulo/tools/proveedor.ts"
import { contenidoModulo } from "../scripts/build-modulo.ts"
import * as appTools from "../src/tools/proveedor.ts"

const raiz = join(import.meta.dir, "..")

test("modulo/ está sincronizado con el prompt y el conocimiento de la aplicación", async () => {
  const { agente, skill } = await contenidoModulo()
  expect(await readFile(join(raiz, "modulo", "agent.md"), "utf8")).toBe(agente)
  expect(await readFile(join(raiz, "modulo", "skill", "registro-proveedor", "SKILL.md"), "utf8")).toBe(skill)
})

test("las herramientas del módulo son las mismas de la aplicación", () => {
  expect(moduloTools.leer_solicitud).toBe(appTools.leer_solicitud)
  expect(Object.keys(moduloTools).sort()).toEqual(Object.keys(appTools).sort())
})
