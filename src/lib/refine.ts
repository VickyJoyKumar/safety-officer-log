function normalizeSpacing(value: string) {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
}

function expandCommonAbbreviations(value: string) {
  const replacements: Array<[RegExp, string]> = [
    [/\bdept\b/gi, 'department'],
    [/\btemp\b/gi, 'temporary'],
    [/\bcondn\b/gi, 'condition'],
    [/\bobs\b/gi, 'observation'],
    [/\bcorr\b/gi, 'correction'],
    [/\breq\b/gi, 'required'],
    [/\bpls\b/gi, 'please'],
    [/\bmsg\b/gi, 'message'],
    [/\binfo\b/gi, 'information'],
  ]

  return replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value)
}

function sentenceCase(value: string) {
  const pieces = value.split(/([.!?]\s*)/)

  return pieces
    .map((piece) => {
      if (/^[.!?]\s*$/.test(piece)) {
        return piece.trim()
      }

      const cleaned = piece.trim()
      if (!cleaned) {
        return ''
      }

      const lowerCased = cleaned
        .split(' ')
        .map((word) => (word.toLowerCase() === 'i' ? 'I' : word))
        .join(' ')

      return lowerCased.charAt(0).toUpperCase() + lowerCased.slice(1)
    })
    .join(' ')
    .replace(/\s+([.!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function refineLocally(value: string) {
  const normalized = normalizeSpacing(value)

  if (!normalized) {
    return ''
  }

  const expanded = expandCommonAbbreviations(normalized)
  const corrected = expanded.replace(/\bi\b/g, 'I')
  const cased = sentenceCase(corrected)

  return /[.!?]$/.test(cased) ? cased : `${cased}.`
}

type ProviderResponse = {
  text?: string
  refinedText?: string
}

function getProviderUrl() {
  const value = import.meta.env.VITE_TEXT_REFINEMENT_URL as string | undefined
  return value?.trim() || ''
}

async function refineViaProvider(value: string) {
  const providerUrl = getProviderUrl()

  if (!providerUrl) {
    return null
  }

  const response = await fetch(providerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text: value,
      mode: 'grammar-cleanup',
      source: 'safety-officer-log',
    }),
  })

  if (!response.ok) {
    return null
  }

  const payload = (await response.json()) as ProviderResponse
  return (payload.refinedText ?? payload.text ?? '').trim() || null
}

export async function refineDictatedText(value: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    return ''
  }

  const providerResult = await refineViaProvider(trimmed).catch(() => null)
  return providerResult ?? refineLocally(trimmed)
}