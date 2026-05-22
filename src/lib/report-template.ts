import type { ObservationRecord } from '../types'
import { normalizeLegacyHindiText } from './text'

export type TemplateReportRow = {
  id: string
  category: ObservationRecord['category']
  location: string
  observation: string
  recommendation: string
  photos: ObservationRecord['photos']
}

export type TemplateReport = {
  heading: string
  reportDate: string
  columns: {
    location: string
    observation: string
    image: string
    recommendations: string
  }
  rows: TemplateReportRow[]
}

const defaultRecommendationByCategory: Record<ObservationRecord['category'], string> = {
  'unsafe-condition': 'To be rectified',
  'good-point': 'To be maintained',
}

export function formatTemplateDate(reportDate: string) {
  const [year, month, day] = reportDate.split('-')
  if (!year || !month || !day) {
    return reportDate
  }
  return `${day}.${month}.${year}`
}

export function buildTemplateHeading(reportDate: string) {
  return `Following unsafe conditions were observed during inspection of BF-2 areas on ${formatTemplateDate(reportDate)}:-`
}

export function buildTemplateReport(observations: ObservationRecord[], reportDate: string): TemplateReport {
  return {
    heading: buildTemplateHeading(reportDate),
    reportDate,
    columns: {
      location: 'Location',
      observation: 'Observation',
      image: 'Image',
      recommendations: 'Recommendations',
    },
    rows: observations.map((observation) => ({
      id: observation.id,
      category: observation.category,
      location: normalizeLegacyHindiText(observation.locationName),
      observation: normalizeLegacyHindiText(observation.description),
      recommendation:
        normalizeLegacyHindiText(observation.correctionNote).trim() ||
        defaultRecommendationByCategory[observation.category],
      photos: observation.photos,
    })),
  }
}
