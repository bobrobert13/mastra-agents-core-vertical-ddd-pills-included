/**
 * Cirugía de mensajes compartida por los guards de entrada (puro, sin red, sin
 * `Agent`): leer el texto de un mensaje y SUSTITUIR el texto del mensaje que un
 * guard acaba de clasificar. Vivía dentro de `scope-guard.ts`; se extrajo aquí
 * para que el guard de inyección haga exactamente la misma cirugía sin
 * duplicarla (una sola razón de cambio: la forma del mensaje de Mastra,
 * `{ role, content: { parts: [{ type: 'text', text }] } }`).
 */

export interface MessageLike {
  role?: string;
  content?: { parts?: unknown[] };
}

/** Texto plano de un mensaje (sus partes de texto unidas); '' si no tiene. */
export function textOfMessage(message: MessageLike | undefined): string {
  const parts = message?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter(
      (part): part is { type: string; text?: string } =>
        typeof part === 'object' && part !== null && (part as { type?: string }).type === 'text'
    )
    .map(part => part.text ?? '')
    .join(' ')
    .trim();
}

/**
 * Índice del último mensaje de usuario **con texto**: es el que los guards
 * clasifican y, en modo redirect, el que se reemplaza.
 */
export function lastUserTextIndex(messages: MessageLike[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== 'user') continue;
    if (textOfMessage(messages[i]) !== '') return i;
  }
  return -1;
}

export function extractLastUserText(messages: MessageLike[]): string {
  const index = lastUserTextIndex(messages);
  return index === -1 ? '' : textOfMessage(messages[index]);
}

/**
 * Sustituye el texto del mensaje en `index` conservando id, rol y formato: el
 * pipeline sigue viendo el mismo mensaje, pero lo que el modelo lee es el texto
 * controlado — nunca la petición original.
 */
export function replaceMessageTextAt(
  messages: MessageLike[],
  index: number,
  text: string
): MessageLike[] {
  if (index < 0 || index >= messages.length) return messages;
  const message = messages[index];
  const content = message?.content;
  if (content === undefined || content === null) return messages;
  const clone = [...messages];
  clone[index] = { ...message, content: { ...content, parts: [{ type: 'text', text }] } };
  return clone;
}

/** Sustituye el texto del último mensaje de USUARIO (el clasificado). */
export function replaceClassifiedUserText(messages: MessageLike[], text: string): MessageLike[] {
  return replaceMessageTextAt(messages, lastUserTextIndex(messages), text);
}

/** Sustituye el texto del ÚLTIMO mensaje (el que escanea un detector `lastMessageOnly`). */
export function replaceLastMessageText(messages: MessageLike[], text: string): MessageLike[] {
  return replaceMessageTextAt(messages, messages.length - 1, text);
}
