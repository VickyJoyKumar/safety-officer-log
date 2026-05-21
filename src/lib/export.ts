export type CsvObservationRow = {
  recordedAt: string
  recordedBy: string
  location: string
  latitude: string | number
  longitude: string | number
  description: string
  correctionNote: string
  photoCount: number
  notes: string
}

function escapeCsv(value: string | number) {
  const text = String(value ?? '')
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`
  }
  return text
}

export function exportObservationsCsv(rows: CsvObservationRow[], fileName: string) {
  const header = [
    'Recorded at',
    'Recorded by',
    'Location',
    'Latitude',
    'Longitude',
    'Description',
    'Correction note',
    'Photo count',
    'Notes',
  ]

  const csv = [
    header,
    ...rows.map((row) => [
      row.recordedAt,
      row.recordedBy,
      row.location,
      row.latitude,
      row.longitude,
      row.description,
      row.correctionNote,
      row.photoCount,
      row.notes,
    ]),
  ]
    .map((line) => line.map(escapeCsv).join(','))
    .join('\r\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = fileName
  link.click()
  URL.revokeObjectURL(link.href)
}

export function triggerPrint() {
  window.print()
}