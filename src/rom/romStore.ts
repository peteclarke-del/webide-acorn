const DATABASE = '8bit-net-dev-roms';
const STORE = 'roms';
const VERSION = 1;

export interface StoredRom {
  key: string;
  filename: string;
  bytes: ArrayBuffer;
  size: number;
  sha256: string;
  importedAt: string;
}

export async function storeRom(key: string, file: File): Promise<StoredRom> {
  const bytes = await file.arrayBuffer();
  const [record] = await storeRomBatch([{ key, filename: file.name, bytes }]);
  return record!;
}

export async function storeRomBatch(items: Array<{ key: string; filename: string; bytes: ArrayBuffer }>): Promise<StoredRom[]> {
  const importedAt = new Date().toISOString();
  const records = await Promise.all(items.map(async (item): Promise<StoredRom> => ({ ...item, size: item.bytes.byteLength, sha256: await sha256(new Uint8Array(item.bytes)), importedAt })));
  const database = await openDatabase();
  await writeBatch(database, records);
  return records;
}

export async function getRom(key: string): Promise<StoredRom | undefined> {
  const database = await openDatabase();
  return transactionPromise(database, 'readonly', (store) => store.get(key));
}

export async function listRoms(prefix = ''): Promise<StoredRom[]> {
  const database = await openDatabase();
  const records = await transactionPromise<StoredRom[]>(database, 'readonly', (store) => store.getAll());
  return records.filter((record) => record.key.startsWith(prefix));
}

export async function removeRom(key: string): Promise<void> {
  const database = await openDatabase();
  await transactionPromise(database, 'readwrite', (store) => store.delete(key));
}

export async function removeRoms(keys: string[]): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite'); const store = transaction.objectStore(STORE);
    keys.forEach((key) => store.delete(key));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('ROM removal failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('ROM removal was aborted'));
  });
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, '0')).join('');
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'key' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('ROM storage could not be opened'));
  });
}

function transactionPromise<T = void>(database: IDBDatabase, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode); const request = operation(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error ?? new Error('ROM storage operation failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('ROM storage transaction aborted'));
  });
}

function writeBatch(database: IDBDatabase, records: StoredRom[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    records.forEach((record) => store.put(record));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('ROM storage operation failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('ROM storage operation aborted'));
  });
}
