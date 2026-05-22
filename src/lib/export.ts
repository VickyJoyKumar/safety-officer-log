import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import type { TemplateReport, TemplateReportRow } from './report-template'

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

function base64ToUint8Array(base64: string) {
  const binary = window.atob(base64)
  const length = binary.length
  const bytes = new Uint8Array(length)

  for (let index = 0; index < length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function dataUrlToImageRun(dataUrl: string) {
  const [prefix, base64Data] = dataUrl.split(',')
  if (!prefix || !base64Data || !prefix.includes(';base64')) {
    return null
  }

  const mimeMatch = prefix.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64$/)
  if (!mimeMatch) {
    return null
  }

  const mimeType = mimeMatch[1].toLowerCase()
  const bytes = base64ToUint8Array(base64Data)

  let type: 'jpg' | 'png' | 'gif' | 'bmp' | null = null
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    type = 'jpg'
  } else if (mimeType === 'image/png') {
    type = 'png'
  } else if (mimeType === 'image/gif') {
    type = 'gif'
  } else if (mimeType === 'image/bmp') {
    type = 'bmp'
  }

  if (!type) {
    return null
  }

  return new ImageRun({
    data: bytes,
    type,
    transformation: {
      width: 220,
      height: 140,
    },
  })
}

function makeCell(children: Paragraph[], width: number) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      left: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      right: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
    },
    children,
  })
}

function buildImageCellParagraphs(photos: TemplateReportRow['photos']) {
  if (photos.length === 0) {
    return [new Paragraph('No image')]
  }

  const firstImage = dataUrlToImageRun(photos[0].dataUrl)
  if (!firstImage) {
    return [new Paragraph('Image format not supported')]
  }

  const paragraphs: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [firstImage],
    }),
  ]

  if (photos.length > 1) {
    paragraphs.push(new Paragraph(`+${photos.length - 1} more image(s)`))
  }

  return paragraphs
}

export async function exportObservationsWord(
  template: TemplateReport,
  fileName: string,
) {
  const heading = new Paragraph({
    text: template.heading,
    spacing: {
      after: 200,
    },
  })

  const table = new Table({
    width: { size: 9360, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        children: [
          makeCell(
            [new Paragraph({ children: [new TextRun({ text: template.columns.location, bold: true })] })],
            1800,
          ),
          makeCell(
            [new Paragraph({ children: [new TextRun({ text: template.columns.observation, bold: true })] })],
            3000,
          ),
          makeCell(
            [new Paragraph({ children: [new TextRun({ text: template.columns.image, bold: true })] })],
            3000,
          ),
          makeCell(
            [new Paragraph({ children: [new TextRun({ text: template.columns.recommendations, bold: true })] })],
            1560,
          ),
        ],
      }),
      ...template.rows.map((row) =>
        new TableRow({
          children: [
            makeCell(
              [
                ...(row.category === 'good-point'
                  ? [new Paragraph({ children: [new TextRun({ text: 'Good Point', bold: true })] })]
                  : []),
                new Paragraph(row.location || '-'),
              ],
              1800,
            ),
            makeCell([new Paragraph(row.observation || '-')], 3000),
            makeCell(buildImageCellParagraphs(row.photos), 3000),
            makeCell([new Paragraph(row.recommendation || 'To be rectified')], 1560),
          ],
        }),
      ),
    ],
  })

  const doc = new Document({
    sections: [
      {
        children: [heading, table],
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = fileName
  link.click()
  URL.revokeObjectURL(link.href)
}