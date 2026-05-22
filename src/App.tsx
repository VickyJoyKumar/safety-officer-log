import { useEffect, useMemo, useRef, useState } from 'react'
import {
  exportObservationsCsv,
  exportObservationsWord,
  triggerPrint,
  type CsvObservationRow,
} from './lib/export'
import { buildTemplateReport } from './lib/report-template'
import {
  DEFAULT_LOCATIONS,
  initializeStorage,
  loadObservations,
  loadLocations,
  saveObservations,
  saveLocations,
  loadSitePlan,
  saveSitePlan,
} from './lib/storage'
import { toLocalDateKey, toLocalDateTimeValue } from './lib/text'
import { refineDictatedText } from './lib/refine'
import type {
  GeoPoint,
  LocationItem,
  ObservationCategory,
  ObservationPhoto,
  ObservationRecord,
  SitePlan,
} from './types'

type DictationTarget = 'description' | 'correctionNote'

type SpeechRecognitionConstructor = new () => SpeechRecognitionController

type SpeechRecognitionController = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionEventLike = {
  results: Array<{
    isFinal: boolean
    0: {
      transcript: string
      confidence: number
    }
    length: 1
  }>
  resultIndex: number
}

type SpeechRecognitionErrorLike = {
  error: string
}

type WindowWithSpeech = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

const todayKey = toLocalDateKey(new Date())

function makeId() {
  return crypto.randomUUID()
}

function appendTranscript(existing: string, transcript: string) {
  const trimmed = transcript.trim()
  if (!trimmed) {
    return existing
  }

  if (!existing.trim()) {
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  }

  return `${existing.trimEnd()} ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load image'))
    image.src = url
  })
}

function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<string>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to create image blob'))
          return
        }

        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
      },
      'image/jpeg',
      quality,
    )
  })
}

async function optimizeImageDataUrl(file: File) {
  if (!file.type.startsWith('image/')) {
    return readFileAsDataUrl(file)
  }

  const originalDataUrl = await readFileAsDataUrl(file)
  const image = await loadImage(originalDataUrl)

  const maxDimension = 1600
  const scale = Math.min(maxDimension / image.width, maxDimension / image.height, 1)
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) {
    return originalDataUrl
  }

  context.drawImage(image, 0, 0, width, height)
  return canvasToJpegDataUrl(canvas, 0.82)
}

function createCsvRows(
  observations: ObservationRecord[],
  locations: LocationItem[],
): CsvObservationRow[] {
  const locationLookup = new Map(locations.map((location) => [location.id, location.name]))

  return observations.map((observation) => ({
    recordedAt: observation.recordedAt,
    recordedBy: observation.recordedBy?.trim() || 'Not specified',
    location: locationLookup.get(observation.locationId) ?? observation.locationName,
    latitude: observation.coordinates?.latitude ?? '',
    longitude: observation.coordinates?.longitude ?? '',
    description: observation.description,
    correctionNote: observation.correctionNote,
    photoCount: observation.photos.length,
    notes: observation.notes,
  }))
}

function App() {
  const [locations, setLocations] = useState<LocationItem[]>(DEFAULT_LOCATIONS)
  const [observations, setObservations] = useState<ObservationRecord[]>([])
  const [locationId, setLocationId] = useState(DEFAULT_LOCATIONS[0]?.id ?? '')
  const [category, setCategory] = useState<ObservationCategory>('unsafe-condition')
  const [newLocationName, setNewLocationName] = useState('')
  const [description, setDescription] = useState('')
  const [correctionNote, setCorrectionNote] = useState('')
  const [recordedBy, setRecordedBy] = useState('Safety Officer')
  const [photos, setPhotos] = useState<ObservationPhoto[]>([])
  const [coordinates, setCoordinates] = useState<GeoPoint | null>(null)
  const [geoStatus, setGeoStatus] = useState('Ready to capture coordinates')
  const [statusMessage, setStatusMessage] = useState('')
  const [reportDate, setReportDate] = useState(todayKey)
  const [dictating, setDictating] = useState<DictationTarget | null>(null)
  const [refiningTarget, setRefiningTarget] = useState<DictationTarget | null>(null)
  const [storageReady, setStorageReady] = useState(false)
  const [sitePlan, setSitePlan] = useState<SitePlan | null>(null)
  const [sitePin, setSitePin] = useState<{ x: number; y: number } | null>(null)
  const cameraPhotoInputRef = useRef<HTMLInputElement | null>(null)
  const uploadPhotoInputRef = useRef<HTMLInputElement | null>(null)
  const sitePlanInputRef = useRef<HTMLInputElement | null>(null)
  const fileReaderQueue = useRef<Promise<void>>(Promise.resolve())
  const recognitionRef = useRef<SpeechRecognitionController | null>(null)

  useEffect(() => {
    initializeStorage()
      .then(() => Promise.all([loadLocations(), loadObservations(), loadSitePlan()]))
      .then(([savedLocations, savedObservations, savedSitePlan]) => {
        setLocations(savedLocations)
        setObservations(savedObservations)
        setLocationId(savedLocations[0]?.id ?? DEFAULT_LOCATIONS[0]?.id ?? '')
        setSitePlan(savedSitePlan)
        setStorageReady(true)
      })
      .catch((error: unknown) => {
        console.error('Failed to initialize storage', error)
        setStorageReady(true)
      })
  }, [])

  useEffect(() => {
    if (!storageReady) {
      return
    }

    saveLocations(locations)
  }, [locations, storageReady])

  useEffect(() => {
    if (!storageReady) {
      return
    }
    saveObservations(observations)
  }, [observations, storageReady])

  useEffect(() => {
    if (!storageReady) {
      return
    }
    saveSitePlan(sitePlan)
  }, [sitePlan, storageReady])

  useEffect(() => {
    if (!dictating) {
      return
    }

    return () => {
      recognitionRef.current?.abort()
      recognitionRef.current = null
    }
  }, [dictating])

  const selectedLocation = useMemo(
    () => locations.find((location) => location.id === locationId) ?? locations[0],
    [locationId, locations],
  )

  const reportRows = useMemo(
    () =>
      observations.filter((observation) => toLocalDateKey(new Date(observation.recordedAt)) === reportDate),
    [observations, reportDate],
  )

  const templateReport = useMemo(() => buildTemplateReport(reportRows, reportDate), [reportRows, reportDate])

  const recentRows = useMemo(() => observations, [observations])

  const totalPhotos = useMemo(
    () => observations.reduce((count, observation) => count + observation.photos.length, 0) + photos.length,
    [observations, photos],
  )

  const handleSitePlanUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setSitePlan({ dataUrl: reader.result as string, name: file.name })
    }
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  const handleSitePlanTap = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setSitePin({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    })
  }

  const handleSitePlanTouch = (event: React.TouchEvent<HTMLDivElement>) => {
    event.preventDefault()
    const touch = event.changedTouches[0]
    if (!touch) return
    const rect = event.currentTarget.getBoundingClientRect()
    setSitePin({
      x: ((touch.clientX - rect.left) / rect.width) * 100,
      y: ((touch.clientY - rect.top) / rect.height) * 100,
    })
  }

  const addLocation = () => {
    const trimmed = newLocationName.trim()
    if (!trimmed) {
      setStatusMessage('Enter a location name first.')
      return
    }

    const exists = locations.some((location) => location.name.toLowerCase() === trimmed.toLowerCase())
    if (exists) {
      setStatusMessage(`${trimmed} already exists.`)
      return
    }

    const nextLocation = { id: makeId(), name: trimmed, createdAt: new Date().toISOString() }
    setLocations((current) => [...current, nextLocation])
    setLocationId(nextLocation.id)
    setNewLocationName('')
    setStatusMessage(`Added ${trimmed}.`)
  }

  const removeLocation = (id: string) => {
    const locationName = locations.find((location) => location.id === id)?.name ?? 'that location'
    const used = observations.some((observation) => observation.locationId === id)

    if (used) {
      setStatusMessage(`Keep ${locationName} because it already has saved observations.`)
      return
    }

    setLocations((current) => current.filter((location) => location.id !== id))
    if (locationId === id) {
      setLocationId(locations.find((location) => location.id !== id)?.id ?? '')
    }
    setStatusMessage(`Removed ${locationName}.`)
  }

  const enqueueFile = (file: File) => {
    fileReaderQueue.current = fileReaderQueue.current.then(
      async () => {
        try {
          const dataUrl = await optimizeImageDataUrl(file)
          setPhotos((current) => [
            ...current,
            {
              id: makeId(),
              name: file.name || `photo-${Date.now()}.jpg`,
              dataUrl,
              capturedAt: new Date().toISOString(),
            },
          ])
        } catch {
          const fallbackDataUrl = await readFileAsDataUrl(file)
          setPhotos((current) => [
            ...current,
            {
              id: makeId(),
              name: file.name || `photo-${Date.now()}.jpg`,
              dataUrl: fallbackDataUrl,
              capturedAt: new Date().toISOString(),
            },
          ])
        }
      },
    )
  }

  const handlePhotoPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) {
      return
    }

    files.forEach((file) => enqueueFile(file))
    event.target.value = ''
    setStatusMessage(`Queued ${files.length} photo${files.length > 1 ? 's' : ''}.`)
  }

  const captureCoordinates = () => {
    if (!navigator.geolocation) {
      setGeoStatus('This browser does not support geolocation.')
      return
    }

    setGeoStatus('Capturing coordinates...')

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        })
        setGeoStatus(
          `Captured with about ${Math.round(position.coords.accuracy)}m accuracy from the device.`,
        )
      },
      (error) => {
        setGeoStatus(error.message)
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    )
  }

  const finishDictation = () => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setDictating(null)
  }

  const startDictation = (target: DictationTarget) => {
    const windowWithSpeech = window as WindowWithSpeech
    const Recognition = windowWithSpeech.SpeechRecognition ?? windowWithSpeech.webkitSpeechRecognition

    if (!Recognition) {
      setStatusMessage('Speech recognition is not available in this browser.')
      return
    }

    finishDictation()

    const recognition = new Recognition()
    recognition.lang = 'en-US'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1]?.[0]?.transcript ?? ''
      if (!transcript.trim()) {
        return
      }

      if (target === 'description') {
        setDescription((current) => appendTranscript(current, transcript))
      } else {
        setCorrectionNote((current) => appendTranscript(current, transcript))
      }
      setStatusMessage(`Captured speech for ${target === 'description' ? 'observation' : 'correction note'}.`)
    }
    recognition.onerror = (event) => {
      setStatusMessage(`Voice capture stopped: ${event.error}.`)
    }
    recognition.onend = () => {
      setDictating(null)
      recognitionRef.current = null
    }

    recognitionRef.current = recognition
    setDictating(target)
    recognition.start()
  }

  const fineTuneField = async (target: DictationTarget) => {
    if (refiningTarget) {
      return
    }

    setRefiningTarget(target)

    try {
      if (target === 'description') {
        setDescription(await refineDictatedText(description))
      } else {
        setCorrectionNote(await refineDictatedText(correctionNote))
      }

      setStatusMessage(`Fine-tuned the ${target === 'description' ? 'observation' : 'correction note'}.`)
    } finally {
      setRefiningTarget(null)
    }
  }

  const submitObservation = async () => {
    if (refiningTarget) {
      return
    }

    const finalLocation = selectedLocation

    if (!finalLocation) {
      setStatusMessage('Create or select a location before saving the observation.')
      return
    }

    const refinedDescription = await refineDictatedText(description)
    const refinedCorrectionNote = await refineDictatedText(correctionNote)

    const entry: ObservationRecord = {
      id: makeId(),
      recordedAt: new Date().toISOString(),
      recordedBy: recordedBy.trim() || 'Not specified',
      category,
      locationId: finalLocation.id,
      locationName: finalLocation.name,
      coordinates,
      description: refinedDescription,
      correctionNote: refinedCorrectionNote,
      notes: '',
      photos,
      sitePin,
    }

    setObservations((current) => [entry, ...current])
    setDescription('')
    setCorrectionNote('')
    setPhotos([])
    setCoordinates(null)
    setSitePin(null)
    setGeoStatus('Ready to capture coordinates')
    setStatusMessage('Observation saved locally.')
  }

  const deleteObservation = (id: string) => {
    setObservations((current) => current.filter((item) => item.id !== id))
    setStatusMessage('Observation deleted.')
  }

  const exportCsv = () => {
    exportObservationsCsv(createCsvRows(reportRows, locations), `safety-observations-${reportDate}.csv`)
  }

  const exportWord = async () => {
    await exportObservationsWord(templateReport, `safety-observations-${reportDate}.docx`)
  }

  const printReport = () => {
    triggerPrint()
  }

  const isInsecureRemote =
    window.location.protocol === 'http:' &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1'

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Local first safety log</p>
          <h1>Record site observations the moment you see them.</h1>
          <p className="hero-copy">
            Capture a predefined location, live coordinates, multiple photos, and dictated notes,
            then review the same day report from a phone or tablet.
          </p>
        </div>

        <div className="hero-actions">
          <button className="primary-button" type="button" onClick={() => document.getElementById('capture-form')?.scrollIntoView({ behavior: 'smooth' })}>
            Record observation
          </button>
          <button className="secondary-button" type="button" onClick={() => document.getElementById('daily-report')?.scrollIntoView({ behavior: 'smooth' })}>
            Review daily report
          </button>
        </div>

        <div className="stats-row">
          <article className="stat-card">
            <span>Observations</span>
            <strong>{observations.length}</strong>
          </article>
          <article className="stat-card">
            <span>Locations</span>
            <strong>{locations.length}</strong>
          </article>
          <article className="stat-card">
            <span>Photos</span>
            <strong>{totalPhotos}</strong>
          </article>
        </div>

        {statusMessage ? <p className="status-line">{statusMessage}</p> : null}
      </section>

      <section id="capture-form" className="panel two-column">
        <div className="panel-block form-block">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Observation entry</p>
              <h2>New record</h2>
            </div>
            <p className="timestamp-chip">Auto date: {new Date().toLocaleDateString()}</p>
          </div>

          <div className="field-grid">
            <label className="field">
              <span>Observation type</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as ObservationCategory)}
              >
                <option value="unsafe-condition">Unsafe condition</option>
                <option value="good-point">Good Point</option>
              </select>
            </label>

            <label className="field">
              <span>Location</span>
              <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Current date and time</span>
              <input type="text" value={toLocalDateTimeValue(new Date())} readOnly />
            </label>
          </div>

          <label className="field">
            <span>Recorded by</span>
            <input
              type="text"
              value={recordedBy}
              onChange={(event) => setRecordedBy(event.target.value)}
              placeholder="Officer name"
              maxLength={80}
            />
          </label>

          {isInsecureRemote ? (
            <p className="status-line" role="alert">
              ⚠️ GPS and voice-to-text require HTTPS on mobile. On this device open{' '}
              <strong>http://localhost:5173</strong> instead, or ask your admin to enable HTTPS.
            </p>
          ) : null}

          <div className="field action-field">
            <div className="field-copy">
              <span>Coordinates</span>
              <strong>
                {coordinates
                  ? `${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`
                  : 'Not captured yet'}
              </strong>
              <p>{geoStatus}</p>
            </div>
            <button className="icon-button" type="button" onClick={captureCoordinates}>
              <MapGlyph />
              Get location
            </button>
          </div>

          <div className="field">
            <div className="field-head">
              <span>Observation</span>
              <div className="inline-actions">
                <button
                  className={`tiny-button ${dictating === 'description' ? 'is-active' : ''}`}
                  type="button"
                  onClick={() => (dictating === 'description' ? finishDictation() : startDictation('description'))}
                  disabled={refiningTarget !== null}
                >
                  <MicGlyph />
                  {dictating === 'description' ? 'Stop voice' : 'Voice to text'}
                </button>
                <button
                  className="tiny-button"
                  type="button"
                  onClick={() => void fineTuneField('description')}
                  disabled={refiningTarget !== null}
                >
                  <SparkGlyph />
                  {refiningTarget === 'description' ? 'Refining...' : 'Fine-tune'}
                </button>
              </div>
            </div>
            <textarea
              rows={6}
              placeholder="Describe the issue you observed..."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="field">
            <div className="field-head">
              <span>Correction note</span>
              <div className="inline-actions">
                <button
                  className={`tiny-button ${dictating === 'correctionNote' ? 'is-active' : ''}`}
                  type="button"
                  onClick={() =>
                    dictating === 'correctionNote' ? finishDictation() : startDictation('correctionNote')
                  }
                  disabled={refiningTarget !== null}
                >
                  <MicGlyph />
                  {dictating === 'correctionNote' ? 'Stop voice' : 'Voice to text'}
                </button>
                <button
                  className="tiny-button"
                  type="button"
                  onClick={() => void fineTuneField('correctionNote')}
                  disabled={refiningTarget !== null}
                >
                  <SparkGlyph />
                  {refiningTarget === 'correctionNote' ? 'Refining...' : 'Fine-tune'}
                </button>
              </div>
            </div>
            <textarea
              rows={4}
              placeholder="What should be corrected or followed up?"
              value={correctionNote}
              onChange={(event) => setCorrectionNote(event.target.value)}
            />
          </div>

          <div className="field action-field">
            <div className="field-copy">
              <span>Photos</span>
              <strong>{photos.length} attached</strong>
              <p>Capture more than one photo before saving.</p>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => cameraPhotoInputRef.current?.click()}
            >
              <CameraGlyph />
              Capture photo
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => uploadPhotoInputRef.current?.click()}
            >
              Upload photo
            </button>
            <input
              ref={cameraPhotoInputRef}
              hidden
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePhotoPick}
            />
            <input
              ref={uploadPhotoInputRef}
              hidden
              type="file"
              accept="image/*"
              multiple
              onChange={handlePhotoPick}
            />
          </div>

          {photos.length > 0 ? (
            <div className="photo-grid">
              {photos.map((photo) => (
                <figure key={photo.id} className="photo-card">
                  <img src={photo.dataUrl} alt={photo.name} />
                  <figcaption>
                    <span>{photo.name}</span>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))}
                    >
                      Remove
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : null}

          {sitePlan ? (
            <div className="field">
              <div className="field-head">
                <span>Site pin</span>
                {sitePin ? (
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => setSitePin(null)}
                  >
                    Clear pin
                  </button>
                ) : null}
              </div>
              <p style={{ fontSize: '0.82rem', marginBottom: 8 }}>
                Tap the plan to mark where you observed the issue.
              </p>
              <div
                className="site-plan-picker"
                onClick={handleSitePlanTap}
                onTouchEnd={handleSitePlanTouch}
                role="button"
                tabIndex={0}
                aria-label="Tap to pin location on site plan"
              >
                <img src={sitePlan.dataUrl} alt="Site plan" />
                {sitePin ? (
                  <div
                    className="site-pin"
                    style={{ left: `${sitePin.x}%`, top: `${sitePin.y}%` }}
                  />
                ) : null}
              </div>
            </div>
          ) : null}

          <button className="primary-button save-button" type="button" onClick={submitObservation}>
            Save observation locally
          </button>
          {!storageReady ? <p className="status-line">Preparing local database...</p> : null}
        </div>

        <aside className="panel-block admin-block">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Admin setup</p>
              <h2>Predefined locations</h2>
            </div>
          </div>

          <div className="add-row">
            <input
              type="text"
              placeholder="Add office room, machine-1 area, store bay..."
              value={newLocationName}
              onChange={(event) => setNewLocationName(event.target.value)}
            />
            <button className="secondary-button" type="button" onClick={addLocation}>
              Add
            </button>
          </div>

          <div className="location-list">
            {locations.map((location) => (
              <div key={location.id} className={`location-pill ${location.id === locationId ? 'is-selected' : ''}`}>
                <button type="button" onClick={() => setLocationId(location.id)}>
                  {location.name}
                </button>
                {location.id !== DEFAULT_LOCATIONS[0]?.id ? (
                  <button type="button" onClick={() => removeLocation(location.id)}>
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          <div className="hint-box">
            <strong>Local only</strong>
            <p>
              Everything is stored on this device for now, and the app shell stays available after
              the first load even if the network drops.
            </p>
          </div>

          <div className="site-plan-admin">
            <div className="panel-heading" style={{ marginBottom: 10 }}>
              <div>
                <p className="eyebrow">Site plan</p>
                <h3>Facility map</h3>
              </div>
            </div>
            {sitePlan ? (
              <>
                <div className="site-plan-display">
                  <img src={sitePlan.dataUrl} alt="Site plan" />
                </div>
                <p style={{ fontSize: '0.8rem', marginTop: 6, color: 'var(--muted)' }}>{sitePlan.name}</p>
                <button
                  className="ghost-button"
                  type="button"
                  style={{ marginTop: 8 }}
                  onClick={() => setSitePlan(null)}
                >
                  Remove plan
                </button>
              </>
            ) : (
              <>
                <p style={{ fontSize: '0.85rem', marginBottom: 10 }}>
                  Upload a floor plan or facility map to enable location pinning on observations.
                </p>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => sitePlanInputRef.current?.click()}
                >
                  Upload site plan
                </button>
                <input
                  ref={sitePlanInputRef}
                  hidden
                  type="file"
                  accept="image/*"
                  onChange={handleSitePlanUpload}
                />
              </>
            )}
          </div>
        </aside>
      </section>

      <section id="daily-report" className="panel report-panel printable-report">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Daily report</p>
            <h2>Review and export</h2>
          </div>
          <div className="inline-actions">
            <button className="secondary-button" type="button" onClick={exportCsv}>
              <DownloadGlyph />
              Spreadsheet export
            </button>
            <button className="secondary-button" type="button" onClick={printReport}>
              Print / PDF
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void exportWord()}
              disabled={templateReport.rows.length === 0}
            >
              <DownloadGlyph />
              Word export
            </button>
          </div>
        </div>

        <div className="report-toolbar">
          <label className="field report-date-field">
            <span>Report date</span>
            <input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} />
          </label>
          <div className="report-summary">
            <strong>{templateReport.rows.length}</strong>
            <span>observations for this date</span>
          </div>
        </div>

        {sitePlan && reportRows.some((row) => row.sitePin) ? (
          <div className="site-hazard-map-container">
            <p className="eyebrow">Hazard map</p>
            <div className="site-hazard-map">
              <img src={sitePlan.dataUrl} alt="Site plan with observation pins" />
              {reportRows.map((row, index) =>
                row.sitePin ? (
                  <div
                    key={row.id}
                    className={`site-pin${row.correctionNote ? ' is-green' : ''}`}
                    style={{ left: `${row.sitePin.x}%`, top: `${row.sitePin.y}%` }}
                    title={row.description}
                  >
                    {index + 1}
                  </div>
                ) : null,
              )}
            </div>
            <p className="site-pin-legend">
              <span className="site-pin-badge">Red</span> Action needed &nbsp;
              <span className="site-pin-badge is-green">Green</span> Correction noted
            </p>
          </div>
        ) : null}

        <div className="report-stack">
          {templateReport.rows.length > 0 ? (
            <div className="report-table-wrap">
              <p className="template-report-intro">{templateReport.heading}</p>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>{templateReport.columns.location}</th>
                    <th>{templateReport.columns.observation}</th>
                    <th>{templateReport.columns.image}</th>
                    <th>{templateReport.columns.recommendations}</th>
                  </tr>
                </thead>
                <tbody>
                  {templateReport.rows.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.category === 'good-point' ? <strong>Good Point</strong> : null}
                        <p>{item.location || '-'}</p>
                        <button className="ghost-button hide-on-print" type="button" onClick={() => deleteObservation(item.id)}>
                          Delete
                        </button>
                      </td>
                      <td>{item.observation || '-'}</td>
                      <td>
                        {item.photos.length > 0 ? (
                          <div className="report-table-photos">
                            {item.photos.map((photo) => (
                              <img key={photo.id} src={photo.dataUrl} alt={photo.name} />
                            ))}
                          </div>
                        ) : (
                          <span>No image</span>
                        )}
                      </td>
                      <td>{item.recommendation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <h3>No observations for this date yet.</h3>
              <p>Capture a new item from the form above and it will appear here after you save it.</p>
            </div>
          )}
        </div>

        <div className="report-footer">
          <div>
            <span className="field-label">Selected location</span>
            <p>{selectedLocation?.name ?? 'No location selected'}</p>
          </div>
          <div>
            <span className="field-label">Saved observations</span>
            <p>{recentRows.length}</p>
          </div>
        </div>
      </section>
    </main>
  )
}

function CameraGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4.5 7.7 6H5.5A2.5 2.5 0 0 0 3 8.5v8A2.5 2.5 0 0 0 5.5 19h13a2.5 2.5 0 0 0 2.5-2.5v-8A2.5 2.5 0 0 0 18.5 6h-2.2L15 4.5H9Zm3 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
    </svg>
  )
}

function MicGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 14.5A3.5 3.5 0 0 0 15.5 11V6.5a3.5 3.5 0 1 0-7 0V11A3.5 3.5 0 0 0 12 14.5Zm6-3a6 6 0 0 1-12 0H4a8 8 0 0 0 7 7.9V21H8v2h8v-2h-3v-1.6A8 8 0 0 0 20 11.5h-2Z" />
    </svg>
  )
}

function SparkGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 2 1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9L12 2Zm6 10 1.2 3.2L22 16l-2.8.8L18 20l-.8-3.2L14.4 16l2.8-.8L18 12Zm-12 0 1.2 3.2L10 16l-2.8.8L6 20l-.8-3.2L2.4 16l2.8-.8L6 12Z" />
    </svg>
  )
}

function MapGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3 3 5.2v15.1L9 18l6 2 6-2.2V2.7L15 5 9 3Zm0 2.2 6 1.8v11l-6-1.8v-11Zm-4 1.5 2-.7v11.1l-2 .7V6.7Zm14 9.6-2 .7V6l2-.7v11Z" />
    </svg>
  )
}

function DownloadGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v10l4-4 1.4 1.4L12 17.8 6.6 10.4 8 9l4 4V3h0ZM5 19h14v2H5v-2Z" />
    </svg>
  )
}

export default App
