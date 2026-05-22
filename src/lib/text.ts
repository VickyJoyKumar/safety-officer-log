import unidev from 'unidev'

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

const shushaOverrides: Record<string, string> = {
  'sTIla': 'स्टील',
  'Aqaa^irTI': 'अथॉरिटी',
  'Aa^f': 'ऑफ',
  '[iNDyaa': 'इंडिया',
  'ilaimaToD': 'लिमिटेड',
  'baaokarao': 'बोकारो',
  'PlaanT': 'प्लांट',
}

function looksLikeLegacyShushaToken(token: string) {
  if (!token.trim()) {
    return false
  }

  if (Object.hasOwn(shushaOverrides, token)) {
    return true
  }

  if (/[[\]`~\\^]/.test(token)) {
    return true
  }

  const hasLower = /[a-z]/.test(token)
  const hasUpper = /[A-Z]/.test(token)
  if (hasLower && hasUpper && !/^[A-Z][a-z]+$/.test(token)) {
    return true
  }

  return false
}

export function normalizeLegacyHindiText(value: string) {
  if (!value.trim()) {
    return value
  }

  const parts = value.split(/(\s+)/)
  let changed = false

  const converted = parts.map((part) => {
    if (/^\s+$/.test(part)) {
      return part
    }

    if (Object.hasOwn(shushaOverrides, part)) {
      changed = true
      return shushaOverrides[part]
    }

    if (!looksLikeLegacyShushaToken(part)) {
      return part
    }

    try {
      const result = unidev(part, 'hindi', 'Shusha')
      if (result !== part && /[\u0900-\u097F]/.test(result)) {
        changed = true
        return result
      }
    } catch {
      return part
    }

    return part
  })

  return changed ? converted.join('') : value
}