const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
  nbsp: ' ',
  shy: '',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  bdquo: '„',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  sbquo: '‚',
  euro: '€',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  middot: '·',
  bull: '•',
  szlig: 'ß',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  aacute: 'á',
  agrave: 'à',
  acirc: 'â',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  euml: 'ë',
  iacute: 'í',
  igrave: 'ì',
  icirc: 'î',
  iuml: 'ï',
  oacute: 'ó',
  ograve: 'ò',
  ocirc: 'ô',
  uacute: 'ú',
  ugrave: 'ù',
  ucirc: 'û',
  ccedil: 'ç',
  ntilde: 'ñ',
  aring: 'å',
  oslash: 'ø',
  aelig: 'æ',
  Eacute: 'É',
  Egrave: 'È',
  Ccedil: 'Ç',
  Ntilde: 'Ñ',
}

const BLOCK_TAGS = /<\/?(?:p|div|br|tr|li|ul|ol|table|h[1-6]|blockquote|pre|hr|section|article|header|footer)\b[^>]*>/gi

/** Converts an HTML body to plain text for indexing; layout is reduced to line breaks. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(BLOCK_TAGS, '\n')
    .replace(/<[^>]*>/g, '')
  return decodeEntities(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (entity, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10)
      return code > 0 && code <= 0x10FFFF
        ? String.fromCodePoint(code)
        : entity
    }
    return NAMED_ENTITIES[body] ?? entity
  })
}
