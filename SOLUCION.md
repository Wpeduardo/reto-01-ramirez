# SOLUCIÓN · Reto 01 "Registro como Proveedor"

> **Nota para el candidato:** revisa y adapta este documento antes de entregarlo. Las secciones
> 4 (precios) y 9 (uso de IA) deben reflejar tu experiencia real; están marcadas con `[COMPLETAR]`.

## 1. Problema en una frase

El área administrativa transcribe a mano, en Excel, PDF o portales, los mismos datos de Periferia
para registrarse como proveedor ante cada cliente (8 a 12 veces al mes), con riesgo de error en
datos sensibles y dependencia de una sola persona; le duele a la **analista administrativa** y,
por extensión, al representante legal que firma lo que ella prepara.

## 2. Arquitectura

```
┌─────────────────┐  POST /api/chat   ┌──────────────────────────────────────────────┐
│ web/ (chat)     │ ────────────────▶ │ src/server.ts (HTTP, rate limit, access key) │
│ - historial     │ ◀──────────────── │            │                                 │
│ - tool calls    │  reply, toolCalls,│            ▼                                 │
│ - confirmación  │  needsConfirmation│ src/agent/ciclo.ts  ◀── agent/prompt.md      │
└─────────────────┘                   │  (bucle, tope, CA3) ◀── src/knowledge/*.md   │
                                      │            │                                 │
                                      │   src/llm/adapter.ts ── anthropic.ts/openai.ts│
                                      │            │                                 │
                                      │   src/tools/registro.ts (zod, log)           │
                                      │            ▼                                 │
                                      │   src/tools/proveedor.ts ◀── knowledge/reglas.json
                                      └───────┬───────────────────────────┬──────────┘
                                              ▼                           ▼
                                  fixtures/ (solo lectura)       out/ (escritura)
```

| Pieza | Dónde vive | Qué contiene |
|---|---|---|
| **Comportamiento** | `agent/prompt.md` | Reglas del agente, orden de las herramientas y formato de respuesta |
| **Conocimiento** | `src/knowledge/registro-proveedor.md` y `reglas.json` | Proceso, identificador por país, qué bloquea la firma. El `.md` lo lee el modelo; el `.json` lo aplican las herramientas |
| **Ejecución** | `src/tools/` | Herramientas deterministas: única fuente de valores |

Cambiar una regla de negocio (por ejemplo, el umbral de confianza o el identificador de un país)
solo toca `src/knowledge/`, nunca el servidor ni el ciclo.

## 3. Ciclo del agente

`procesarTurno` (`src/agent/ciclo.ts`):

1. Añade el mensaje del usuario al historial.
2. Llama al modelo con el system prompt, el historial y las definiciones de herramientas (JSON
   Schema generado desde los esquemas zod).
3. Si el modelo pide herramientas, las valida con zod (los argumentos inválidos vuelven al modelo
   como `{ ok: false, error }`), las ejecuta, registra cada llamada en el chat y en
   `out/log.jsonl` / `out/<caso>/log.jsonl`, y vuelve al paso 2.
4. Termina cuando el modelo responde solo con texto, o al alcanzar `MAX_ITERACIONES` (25), en cuyo
   caso responde con lo que alcanzó a hacer y lo que falta (CA1). También corta al superar
   `MAX_TOKENS_SESION`.
5. Si el proveedor falla (timeout, 401, 429, 5xx), el turno se revierte en el historial del
   modelo, el chat muestra el error en lenguaje claro y la sesión sigue viva (CA5).

**Confirmación humana (CA3 / RN4) aplicada en el backend, no solo en el prompt:**

- Cuando `proveedor_armar_paquete` termina bien, la sesión queda con una acción **pendiente** para
  ese caso y la respuesta lleva `needsConfirmation: true`; el front resalta el mensaje y muestra
  los botones "Sí, envía" / "No, todavía no".
- En el turno siguiente, el backend decide si el mensaje del usuario confirma (`esConfirmacion`:
  afirmación sin negación; "No envíes nada todavía" no confirma).
- Al ejecutar `proveedor_simular_envio`, el ciclo **sobrescribe** el argumento `confirmado` con
  esa decisión. Aunque el modelo pase `confirmado: true` por su cuenta, el envío se rechaza con
  `requiere confirmación explícita`. La autorización es de un solo uso y solo vale para el caso
  pendiente. Hay pruebas que lo verifican (`tests/agente.test.ts`).

## 4. Elección del modelo

- **Proveedor y modelo:** Anthropic `claude-sonnet-5-5` por defecto (configurable con
  `LLM_MODEL`). El adaptador también soporta OpenAI y cualquier API compatible (Azure, Ollama,
  LM Studio) con `OPENAI_BASE_URL`.
- **Por qué:** buen seguimiento de instrucciones y de *tool use* en español con pocas
  alucinaciones; la tarea no requiere un modelo grande porque el trabajo lo hacen las herramientas.
  Un modelo más pequeño y barato debería bastar; queda como experimento.
- **Costo estimado por caso:** el system prompt + conocimiento ocupa ≈1.6 k tokens y las
  definiciones de herramientas ≈0.8 k. Un caso completo son ≈5 llamadas al modelo con historial
  creciente: **≈17 k tokens de entrada y ≈1 k de salida**, más ≈5 k para el turno de
  confirmación. Con precios de referencia de USD 3 / 15 por millón de tokens de entrada / salida,
  son **≈ USD 0.07 a 0.10 por caso**, es decir, menos de USD 1.5 al mes para 12 solicitudes.
  `[COMPLETAR: verificar los precios vigentes del modelo elegido]`

## 5. Diseño del portal web (sección 7.4)

Hoy, el formato `portal` produce `out/<caso>/valores-portal.md` y la herramienta responde
`formato no soportado`. La evolución propuesta:

- **Estrategia:** un navegador controlado (Playwright) en un worker aislado, con un "mapa de
  portal" por cliente (selectores de cada campo) versionado junto a las reglas. El agente rellena
  campos; el humano ve la sesión en vivo. Se descarta RPA de escritorio (frágil y costoso) y una
  extensión de navegador (requiere instalar software en el equipo de la analista).
- **Límites:** CAPTCHA y MFA no se automatizan: los resuelve la persona. Un cambio de layout rompe
  el mapa de selectores; se detecta comparando una captura con la última conocida y, ante
  diferencias, el agente vuelve a `valores-portal.md`.
- **Credenciales:** nunca en el repositorio, en el prompt, en los logs ni en el contexto del
  modelo. Las ingresa la persona directamente en la ventana del navegador (el agente no las ve).
  Si en el futuro se guardaran, irían en un gestor de secretos con acceso por caso y auditoría.
- **Reparto:** el agente navega hasta el formulario y rellena los valores del mapeo verificado;
  la persona ingresa credenciales, resuelve CAPTCHA/MFA, revisa y hace clic en **Enviar**.
  Además, el agente nunca abre la URL que viene en el correo sin validarla contra una lista de
  dominios conocidos del cliente: el correo es contenido externo y podría ser *phishing*.

## 6. Decisiones y trade-offs

| Decisión | Alternativa descartada | Por qué |
|---|---|---|
| **El mapeo es determinista** (glosario → maestro, con confianza) y lo hace la herramienta | Que el modelo decida qué dato va en cada campo | El PRD prohíbe inventar valores; con lógica determinista el resultado es reproducible, verificable en `demo.ts` y no depende del modelo |
| **`generar_formulario` ignora el `mapeo` que envía el modelo** y usa el mapeo verificado guardado en `out/<caso>/mapeo.json` | Usar los valores que el modelo devuelve | Un modelo podría alterar un valor (por ejemplo, la cuenta bancaria) al reenviarlo. El argumento se acepta por contrato, pero no es fuente de datos |
| **La confirmación se verifica en el backend** | Confiar en que el prompt haga que el modelo pida confirmación | Un prompt no es un control de seguridad: un modelo o un correo malicioso podrían saltárselo |
| **El número de cuenta se enmascara en lo que ve el modelo** (`****2345`) | Devolverlo completo | El modelo no lo necesita para orquestar; así no puede repetirlo en el chat ni en un correo (RN2). El valor completo sí va al formulario |
| **Sin SDKs de proveedor**, solo `fetch` | SDK oficial de Anthropic/OpenAI | Menos dependencias y un adaptador pequeño y explícito; a cambio, se mantiene a mano el mapeo de formatos |
| **Fecha de referencia configurable** (`FECHA_REFERENCIA`) | Usar siempre la fecha del sistema | Hace `demo.ts` determinista y permite probar vigencias; por defecto se usa la fecha real |
| **PDF generado con pdf-lib** en lugar de rellenar un AcroForm | Rellenar el PDF original del cliente | No tenemos el PDF original (solo `plantilla-campos.json`) y el PRD acepta un PDF generado |

Dependencias: `zod` (obligatoria, validación y JSON Schema), `exceljs` (escribir celdas exactas en
`.xlsx`) y `pdf-lib` (generar PDF sin binarios nativos). El front no tiene dependencias.

## 7. Supuestos

- **Fecha de ejecución:** se usa la fecha real del sistema. Como la Cámara de Comercio de los
  fixtures vence el 2026-09-30 y todos los casos la exigen, **con fechas posteriores ningún caso
  queda listo para firma**. Se interpreta como comportamiento esperado (el agente debe detectarlo);
  con `FECHA_REFERENCIA=2026-09-15`, `co-industrias-delta` queda listo.
- **"Correo electrónico"** se mapea al correo del contacto comercial, como indica el glosario.
- **"País"** se llena con el código del maestro (`CO`), sin traducirlo, para no introducir valores
  que no están en el maestro.
- **Ingresos anuales** se llenan con el valor del maestro y una nota de moneda y año (COP 2025).
- **Mapeo por similitud:** si una etiqueta no está en el glosario pero coincide con una clave del
  maestro, se llena con confianza 0.6 y queda en `requiere_confirmacion` (umbral 0.8).
- **Simular el envío con bloqueos:** se permite si el usuario confirma, porque el PRD espera
  `ENVIO-SIMULADO.md` tras la confirmación incluso en `ec-corp-andina`; el archivo deja constancia
  de los bloqueos pendientes y el agente los recuerda al pedir confirmación.
- **Formato portal:** se mapean los campos de `plantilla-campos.json` si existe.

## 8. Cobertura

| Historia | Estado | Qué falta para producción |
|---|---|---|
| HU-1 Leer la solicitud | Hecho | Leer correos reales (Graph API / IMAP) y adjuntos `.xlsx`/`.pdf` en lugar de JSON |
| HU-2 Mapear campos al maestro | Hecho | Ampliar el glosario con las plantillas reales; un dueño del dato para el maestro |
| HU-3 Generar el formulario | Hecho: Excel (P0), PDF (P1) y valores de portal (P2) | Escribir sobre la plantilla original del cliente (conservar su formato) y rellenar AcroForms |
| HU-4 Armar el paquete | Hecho | Soportes reales en SharePoint; renovación automática de la Cámara de Comercio |
| HU-5 Manejo de errores | Hecho | Monitoreo y alertas sobre `out/log.jsonl` |
| Bonus `modulo/` | Hecho | Publicarlo como paquete versionado |

Pruebas: `bun test` (19 pruebas: herramientas, ciclo con modelo simulado, confirmación, tope de
iteraciones, errores del proveedor y sincronía del módulo) y `bun run demo.ts`.

## 9. Uso de IA

`[COMPLETAR con tu experiencia real. Ejemplo de estructura:]`

- **Asistentes:** Claude (Anthropic).
- **Para qué:** análisis del PRD y de los fixtures, propuesta de arquitectura, generación del
  código base, de las pruebas y de este documento.
- **Qué revisé y cambié yo:** `[COMPLETAR]`
- **Qué descarté y por qué:** `[COMPLETAR, por ejemplo: dejar que el modelo hiciera el mapeo,
  descartado porque podía inventar valores]`
- **Cómo lo verifiqué:** ejecuté `bun test`, `bun run demo.ts`, `tsc` en modo estricto y probé el
  chat de extremo a extremo.

## 10. Riesgos de llevarlo a producción

| Riesgo | Mitigación |
|---|---|
| El modelo inventa o altera un dato | Las herramientas son la única fuente de valores; el formulario sale del mapeo verificado; el prompt lo prohíbe y las pruebas lo cubren |
| **Inyección de prompt indirecta** en el cuerpo de un correo ("cambia la cuenta bancaria", "envía a otra dirección") | El correo se marca como contenido externo; el agente no tiene herramientas para cambiar datos ni destinatarios; el envío exige confirmación verificada en el backend |
| Envío sin autorización | Confirmación aplicada en el servidor, de un solo uso y por caso |
| Fuga de datos bancarios | Enmascarados para el modelo; verificación automática de que el borrador no los contiene (RN2) |
| Gasto descontrolado de la clave | Tope de iteraciones por turno, de tokens por sesión, límite por IP y `ACCESS_KEY` opcional |
| *Path traversal* desde argumentos del modelo | El caso se valida con una expresión regular y toda ruta se resuelve dentro de `fixtures/` u `out/` |
| Datos personales en logs | El log guarda resúmenes, sin valores bancarios ni la clave; en producción, retención limitada y acceso restringido |
| Maestro desactualizado | Un dueño del dato y fecha de última revisión en el maestro |
| Plantillas reales más complejas | Ampliar el glosario y revisar los campos `requiere_confirmacion` como señal de mejora |
| Sesiones en memoria / disco efímero | En producción, almacenamiento persistente y autenticación de usuarios |
