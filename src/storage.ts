/** Stockage des avatars importés (fichiers .vrm de plusieurs Mo) dans IndexedDB. */
const DB_NAME = 'companion'
const STORE = 'avatars'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }).finally(() => db.close()) as Promise<T>
}

export const saveAvatarFile = (id: string, file: Blob) => tx('readwrite', (s) => s.put(file, id))
export const loadAvatarFile = (id: string) => tx<Blob | undefined>('readonly', (s) => s.get(id))
export const deleteAvatarFile = (id: string) => tx('readwrite', (s) => s.delete(id))
