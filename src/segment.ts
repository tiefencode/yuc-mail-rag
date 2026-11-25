export interface Segments {
  /** Text that is neither quoted nor signature. */
  own: string
  quoted: string
  signature: string
  /** Number of non-empty quoted lines. */
  quotedLines: number
}

const FORWARD_MARKER = /^[\s>-]*(?:begin forwarded message|anfang der weitergeleiteten nachricht|forwarded message|weitergeleitete nachricht)(?:\s*:)?[\s-]*$/i
const OUTLOOK_SEPARATOR = /^\s*-{2,}\s*(?:original message|ursprüngliche nachricht)\s*-{2,}\s*$/i
const ATTRIBUTION_START = /^\s*(?:on|am)\s/i
const ATTRIBUTION = /^\s*(?:on\s.*\swrote|am\s.*\sschrieb\b.*):\s*$/i
const HEADER_FROM = /^\s*\*?(?:from|von)\s*:\*?\s*\S/i
const HEADER_SENT = /^\s*\*?(?:sent|gesendet)\s*:/i
const SIGNATURE_DELIMITER = /^--\s?$/
const DEVICE_LINE = /^\s*(?:sent from my (?:iphone|ipad|android|mobile)|von meinem (?:iphone|ipad|smartphone|android)[\w\s-]*gesendet|gesendet von meinem (?:iphone|ipad|smartphone)|get outlook for (?:ios|android))\b.*$/i
const FORWARD_HEADER_LINES = 8

type Part = 'own' | 'quoted' | 'signature'

/** Splits a plain-text body into own text, quoted text and signature with German and English markers. */
export function segment(text: string): Segments {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const parts: Record<Part, string[]> = { own: [], quoted: [], signature: [] }
  let replyStarted = false
  let inSignature = false
  let forwardHeaderUntil = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (FORWARD_MARKER.test(line)) {
      replyStarted = false
      inSignature = false
      forwardHeaderUntil = i + FORWARD_HEADER_LINES
      parts.own.push(line)
      continue
    }
    if (!replyStarted && isReplyMarker(lines, i, i <= forwardHeaderUntil))
      replyStarted = true

    if (replyStarted || /^\s*>/.test(line)) {
      parts.quoted.push(line.replace(/^\s*(?:>\s?)+/, ''))
    }
    else if (inSignature) {
      parts.signature.push(line)
    }
    else if (SIGNATURE_DELIMITER.test(line)) {
      inSignature = true
    }
    else if (DEVICE_LINE.test(line)) {
      parts.signature.push(line)
    }
    else {
      parts.own.push(line)
    }
  }

  return {
    own: trimLines(parts.own),
    quoted: trimLines(parts.quoted),
    signature: trimLines(parts.signature),
    quotedLines: parts.quoted.filter(line => line.trim() !== '').length,
  }
}

function isReplyMarker(lines: string[], i: number, inForwardHeader: boolean): boolean {
  const line = lines[i]!
  if (OUTLOOK_SEPARATOR.test(line) || ATTRIBUTION.test(line))
    return true
  if (ATTRIBUTION_START.test(line) && i + 1 < lines.length && ATTRIBUTION.test(`${line} ${lines[i + 1]}`))
    return true
  if (!inForwardHeader && HEADER_FROM.test(line))
    // A `Date:` line is not enough: forwarded headers have one too; Outlook replies write `Sent:`/`Gesendet:`.
    return lines.slice(i + 1, i + 4).some(next => HEADER_SENT.test(next))
  return false
}

function trimLines(lines: string[]): string {
  let start = 0
  let end = lines.length
  while (start < end && lines[start]!.trim() === '')
    start++
  while (end > start && lines[end - 1]!.trim() === '')
    end--
  return lines.slice(start, end).join('\n')
}
