// CA3 / RN4: la confirmación humana se verifica en el backend a partir del texto del usuario,
// no a partir de lo que diga el modelo.
import { normalizar } from "../tools/lib/mapeo.ts"

const NEGACION = /\b(no|todavia|aun no|espera|esperar|cancela|cancelar|detente|alto)\b/
const AFIRMACION = /\b(si|confirmo|confirmado|confirma|envia|enviala|envialo|enviar|adelante|procede|dale|ok|okay|de acuerdo|hazlo|autorizo)\b/

/** true si el mensaje confirma la acción pendiente y no contiene una negación. */
export function esConfirmacion(texto: string): boolean {
  const t = normalizar(texto)
  if (NEGACION.test(t)) return false
  return AFIRMACION.test(t)
}
