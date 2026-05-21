export type GeoPoint = {
  latitude: number
  longitude: number
  accuracy?: number
}

export type LocationItem = {
  id: string
  name: string
  createdAt: string
}

export type ObservationPhoto = {
  id: string
  name: string
  dataUrl: string
  capturedAt: string
}

export type SitePlan = {
  dataUrl: string
  name: string
}

export type ObservationRecord = {
  id: string
  recordedAt: string
  recordedBy?: string
  locationId: string
  locationName: string
  coordinates: GeoPoint | null
  description: string
  correctionNote: string
  notes: string
  photos: ObservationPhoto[]
  sitePin: { x: number; y: number } | null
}