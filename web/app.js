// Front del chat: historial, llamadas a herramientas visibles y estado de confirmación resaltado.
const $ = (id) => document.getElementById(id)
const conversacion = $("conversacion")
const entrada = $("mensaje")
const botonEnviar = $("enviar")
const panelConfirmacion = $("confirmacion")

// Almacenamiento del navegador: solo comodidades (id de sesión y clave de acceso); puede fallar.
const guardado = {
  leer(clave) {
    try { return localStorage.getItem(clave) } catch { return null }
  },
  escribir(clave, valor) {
    try { valor === null ? localStorage.removeItem(clave) : localStorage.setItem(clave, valor) } catch { /* sin almacenamiento */ }
  },
}

let sessionId = guardado.leer("sessionId")
let ocupado = false

function escapar(texto) {
  return texto.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
}

function enLinea(texto) {
  return escapar(texto)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
}

/** Markdown mínimo y seguro: escapa todo y solo reconoce negrita, código en línea y listas. */
function markdown(texto) {
  const html = []
  let lista = []
  const cerrarLista = () => {
    if (lista.length) html.push(`<ul>${lista.map((i) => `<li>${enLinea(i)}</li>`).join("")}</ul>`)
    lista = []
  }
  for (const linea of texto.split("\n")) {
    const item = /^\s*[-*]\s+(.*)$/.exec(linea)
    if (item) { lista.push(item[1]); continue }
    cerrarLista()
    if (linea.trim()) html.push(`<p>${enLinea(linea.replace(/^#+\s*/, ""))}</p>`)
  }
  cerrarLista()
  return html.join("")
}

function ocultarBienvenida() {
  const bienvenida = $("bienvenida")
  if (bienvenida) bienvenida.hidden = true
}

function agregarMensaje(tipo, texto, pideConfirmacion = false) {
  ocultarBienvenida()
  const div = document.createElement("div")
  div.className = `mensaje ${tipo}${pideConfirmacion ? " pide-confirmacion" : ""}`
  if (tipo === "usuario") div.textContent = texto
  else div.innerHTML = markdown(texto)
  conversacion.appendChild(div)
  div.scrollIntoView({ behavior: "smooth", block: "end" })
}

function agregarHerramienta({ nombre, args, ok, resumen }) {
  ocultarBienvenida()
  const detalles = document.createElement("details")
  detalles.className = "herramienta"
  const resumenEl = document.createElement("summary")
  resumenEl.innerHTML = `<span>🔧</span><span class="nombre">${escapar(nombre)}</span><span class="estado ${ok ? "ok" : "fallo"}">${ok ? "ok" : "error"}</span><span class="resumen">${escapar(resumen)}</span>`
  const pre = document.createElement("pre")
  pre.textContent = JSON.stringify(args, null, 2)
  detalles.append(resumenEl, pre)
  conversacion.appendChild(detalles)
}

function mostrarConfirmacion(visible) {
  panelConfirmacion.hidden = !visible
}

function cabeceras() {
  const h = { "content-type": "application/json" }
  const clave = guardado.leer("accessKey")
  if (clave) h["x-access-key"] = clave
  return h
}

async function pedir(url, opciones = {}) {
  let respuesta = await fetch(url, { ...opciones, headers: cabeceras() })
  if (respuesta.status === 401) {
    const clave = window.prompt("Este agente está protegido. Ingresa la clave de acceso:")
    if (!clave) throw new Error("Se necesita la clave de acceso")
    guardado.escribir("accessKey", clave)
    respuesta = await fetch(url, { ...opciones, headers: cabeceras() })
  }
  const datos = await respuesta.json().catch(() => ({}))
  if (!respuesta.ok) throw new Error(datos.error || `Error ${respuesta.status}`)
  return datos
}

function indicadorPensando() {
  const div = document.createElement("div")
  div.className = "pensando"
  div.textContent = "El agente está trabajando…"
  conversacion.appendChild(div)
  div.scrollIntoView({ behavior: "smooth", block: "end" })
  return div
}

function bloquear(valor) {
  ocupado = valor
  botonEnviar.disabled = valor
  $("confirmar").disabled = valor
  $("cancelar").disabled = valor
}

async function enviar(texto) {
  if (ocupado || !texto.trim()) return
  bloquear(true)
  mostrarConfirmacion(false)
  agregarMensaje("usuario", texto)
  const pensando = indicadorPensando()
  try {
    const datos = await pedir("/api/chat", { method: "POST", body: JSON.stringify(sessionId ? { sessionId, message: texto } : { message: texto }) })
    sessionId = datos.sessionId
    guardado.escribir("sessionId", sessionId)
    datos.toolCalls.forEach(agregarHerramienta)
    agregarMensaje(datos.error ? "error" : "asistente", datos.reply, datos.needsConfirmation)
    mostrarConfirmacion(datos.needsConfirmation)
  } catch (error) {
    agregarMensaje("error", `No pude enviar el mensaje: ${error.message}`)
  } finally {
    pensando.remove()
    bloquear(false)
    entrada.focus()
  }
}

async function restaurar() {
  if (!sessionId) return
  try {
    const datos = await pedir(`/api/sessions/${encodeURIComponent(sessionId)}`)
    for (const e of datos.history) {
      if (e.tipo === "herramienta") agregarHerramienta(e)
      else agregarMensaje(e.tipo, e.texto, e.tipo === "asistente" && e.needsConfirmation)
    }
    mostrarConfirmacion(datos.needsConfirmation)
  } catch {
    sessionId = null
    guardado.escribir("sessionId", null)
  }
}

async function estadoModelo() {
  try {
    const datos = await (await fetch("/api/health")).json()
    $("estado-modelo").textContent = datos.configured ? `${datos.provider} · ${datos.model}` : "sin clave del modelo"
  } catch {
    $("estado-modelo").textContent = "sin conexión"
  }
}

$("formulario").addEventListener("submit", (e) => {
  e.preventDefault()
  const texto = entrada.value
  entrada.value = ""
  enviar(texto)
})
entrada.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault()
    $("formulario").requestSubmit()
  }
})
$("confirmar").addEventListener("click", () => enviar("Sí, confirmo: envía el paquete."))
$("cancelar").addEventListener("click", () => enviar("No, todavía no envíes nada."))
$("nueva").addEventListener("click", () => {
  guardado.escribir("sessionId", null)
  window.location.reload()
})
document.querySelectorAll(".sugerencia").forEach((b) => b.addEventListener("click", () => enviar(b.dataset.texto)))

estadoModelo()
restaurar()
