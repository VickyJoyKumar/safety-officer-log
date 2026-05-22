import type { LocationItem, ObservationRecord, SitePlan } from '../types'

const DB_NAME = 'safety-officer-log'
const DB_VERSION = 2
const LOCATION_STORE = 'locations'
const OBSERVATION_STORE = 'observations'
const SETTINGS_STORE = 'settings'
const LEGACY_LOCATION_KEY = 'safety-log.locations.v1'
const LEGACY_OBSERVATION_KEY = 'safety-log.observations.v1'

export const DEFAULT_LOCATIONS: LocationItem[] = [
  {
    id: 'office-room',
    name: 'Office room',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'machine-1-area',
    name: 'Machine-1 area',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'store-bay',
    name: 'Store bay',
    createdAt: new Date().toISOString(),
  },
]

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(LOCATION_STORE)) {
        db.createObjectStore(LOCATION_STORE, { keyPath: 'id' })
      }

      if (!db.objectStoreNames.contains(OBSERVATION_STORE)) {
        db.createObjectStore(OBSERVATION_STORE, { keyPath: 'id' })
      }

      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function readAll<T>(storeName: string) {
  const db = await openDatabase()

  return new Promise<T[]>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly')
    const request = transaction.objectStore(storeName).getAll()

    request.onsuccess = () => resolve(request.result as T[])
    request.onerror = () => reject(request.error)
    transaction.oncomplete = () => db.close()
    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
  })
}

async function writeAll<T extends { id: string }>(storeName: string, records: T[]) {
  const db = await openDatabase()

  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)

    store.clear()
    for (const record of records) {
      store.put(record)
    }

    transaction.oncomplete = () => {
      db.close()
      resolve()
    }

    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
  })
}

function readLegacyJson<T>(key: string, fallback: T) {
  const raw = window.localStorage.getItem(key)

  if (!raw) {
    return fallback
  }

  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function normalizeObservation(record: ObservationRecord): ObservationRecord {
  return {
    ...record,
    category: record.category === 'good-point' ? 'good-point' : 'unsafe-condition',
  }
}

async function migrateLegacyData() {
  const legacyLocations = readLegacyJson<LocationItem[]>(LEGACY_LOCATION_KEY, DEFAULT_LOCATIONS)
  const legacyObservations = readLegacyJson<ObservationRecord[]>(LEGACY_OBSERVATION_KEY, []).map(
    normalizeObservation,
  )

  const currentLocations = await readAll<LocationItem>(LOCATION_STORE)
  const rawCurrentObservations = await readAll<ObservationRecord>(OBSERVATION_STORE)
  const currentObservations = rawCurrentObservations.map(normalizeObservation)
  const needsCurrentNormalization = rawCurrentObservations.some(
    (record) => record.category !== 'unsafe-condition' && record.category !== 'good-point',
  )

  if (currentLocations.length === 0) {
    await writeAll(LOCATION_STORE, legacyLocations)
  }

  if (currentObservations.length === 0 && legacyObservations.length > 0) {
    await writeAll(OBSERVATION_STORE, legacyObservations)
  } else if (needsCurrentNormalization) {
    await writeAll(OBSERVATION_STORE, currentObservations)
  }

  window.localStorage.removeItem(LEGACY_LOCATION_KEY)
  window.localStorage.removeItem(LEGACY_OBSERVATION_KEY)
}

export async function initializeStorage() {
  await migrateLegacyData()
}

export async function loadLocations() {
  const locations = await readAll<LocationItem>(LOCATION_STORE)
  return locations.length > 0 ? locations : DEFAULT_LOCATIONS
}

export async function saveLocations(locations: LocationItem[]) {
  await writeAll(LOCATION_STORE, locations)
}

export async function loadObservations() {
  return (await readAll<ObservationRecord>(OBSERVATION_STORE)).map(normalizeObservation)
}

export async function saveObservations(observations: ObservationRecord[]) {
  await writeAll(OBSERVATION_STORE, observations)
}

export async function loadSitePlan(): Promise<SitePlan | null> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SETTINGS_STORE, 'readonly')
    const request = transaction.objectStore(SETTINGS_STORE).get('sitePlan')
    request.onsuccess = () => {
      db.close()
      resolve((request.result as { key: string; value: SitePlan } | undefined)?.value ?? null)
    }
    request.onerror = () => {
      db.close()
      reject(request.error)
    }
  })
}

export async function saveSitePlan(plan: SitePlan | null): Promise<void> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SETTINGS_STORE, 'readwrite')
    const store = transaction.objectStore(SETTINGS_STORE)
    if (plan) {
      store.put({ key: 'sitePlan', value: plan })
    } else {
      store.delete('sitePlan')
    }
    transaction.oncomplete = () => {
      db.close()
      resolve()
    }
    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
  })
}