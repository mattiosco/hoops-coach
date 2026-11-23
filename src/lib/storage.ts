import { createStore, del, get, set } from 'idb-keyval'

/**
 * Ask the browser to make our storage persistent. Without this, iOS and Chrome are both
 * free to evict IndexedDB under storage pressure — which for us means losing a season's
 * roster and minutes. Best-effort: the answer is a browser heuristic, not a guarantee,
 * which is exactly why JSON export exists as a backstop (phase 5).
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted?.()) return true
  return navigator.storage.persist()
}

export async function estimateUsage(): Promise<string | null> {
  if (!navigator.storage?.estimate) return null
  const { usage, quota } = await navigator.storage.estimate()
  if (usage == null || quota == null) return null
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${mb(usage)} of ${mb(quota)}`
}

/**
 * A database of our own. The soccer coach app lives on the same origin, and idb-keyval's
 * default store is shared by every page on an origin — without this the two apps would
 * read and overwrite each other's teams.
 */
const db = createStore('hoops-coach', 'keyval')

export const store = {
  get: <T>(key: string) => get<T>(key, db),
  set: (key: string, value: unknown) => set(key, value, db),
  del: (key: string) => del(key, db),
}
