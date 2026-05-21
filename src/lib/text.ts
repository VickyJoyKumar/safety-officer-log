export function toLocalDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function toLocalDateTimeValue(date: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function cleanupDictatedText(value: string) {
  const trimmed = value.replace(/\s+/g, ' ').trim()

  if (!trimmed) {
    return ''
  }

  const sentenceCased = trimmed
    .replace(/\bi\b/g, 'I')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([.?!])\s*([a-z])/g, (_match, punct: string, nextChar: string) => `${punct} ${nextChar.toUpperCase()}`)

  const capitalized = sentenceCased.charAt(0).toUpperCase() + sentenceCased.slice(1)

  return /[.?!]$/.test(capitalized) ? capitalized : `${capitalized}.`
}