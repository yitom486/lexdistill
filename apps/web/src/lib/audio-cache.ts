/**
 * 本地语音缓存系统（IndexedDB 持久化）：
 * 避免重复合成造成的二次开销与 API 计费。
 * 键规则基于归一化入参（服务商、音色、模型、语速、语种、意图与文本内容）。
 */

export interface CachedAudioRecord {
  id: string;
  text: string;
  provider: string;
  voice: string;
  model: string;
  rate: number;
  lang: string;
  purpose: string;
  mimeType: string;
  sizeBytes: number;
  blob: Blob;
  createdAt: number;
  lastPlayedAt: number;
}

export interface AudioCacheStats {
  count: number;
  totalBytes: number;
}

const DB_NAME = 'study_studio_audio_cache_db';
const DB_VERSION = 1;
const STORE_NAME = 'audio_records';

/** 内存兜底回退（在无 IndexedDB 环境如部分单元测试/SSR 中保证不崩溃） */
const memoryStore = new Map<string, CachedAudioRecord>();

export function buildAudioCacheKey(params: {
  text: string;
  provider: string;
  voice: string;
  model?: string | undefined;
  rate?: number | undefined;
  lang?: string | undefined;
  purpose?: string | undefined;
}): string {
  const normText = params.text.trim().toLowerCase();
  const provider = (params.provider || '').toLowerCase().trim();
  const voice = (params.voice || '').toLowerCase().trim();
  const model = provider === 'gemini' ? (params.model || '').toLowerCase().trim() : '';
  const rate = Number.isFinite(params.rate) ? Math.round((params.rate as number) * 100) / 100 : 1;
  const lang = (params.lang || '').toLowerCase().trim();
  const purpose = (params.purpose || '').toLowerCase().trim();
  return `${provider}::${voice}::${model}::${rate}::${lang}::${purpose}::${normText}`;
}

function hasIndexedDB(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDB()) {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('lastPlayedAt', 'lastPlayedAt', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open audio cache database'));
  });
}

export async function getAudioCache(id: string): Promise<CachedAudioRecord | null> {
  if (!id) return null;
  if (!hasIndexedDB()) {
    return memoryStore.get(id) ?? null;
  }
  try {
    const db = await openDatabase();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve((req.result as CachedAudioRecord) || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return memoryStore.get(id) ?? null;
  }
}

export async function saveAudioCache(
  item: Omit<CachedAudioRecord, 'createdAt' | 'lastPlayedAt'> & {
    createdAt?: number;
    lastPlayedAt?: number;
  },
): Promise<void> {
  if (!item.id || !item.blob) return;
  const now = Date.now();
  const record: CachedAudioRecord = {
    ...item,
    createdAt: item.createdAt ?? now,
    lastPlayedAt: item.lastPlayedAt ?? now,
    sizeBytes: item.sizeBytes || item.blob.size,
  };

  memoryStore.set(record.id, record);

  if (!hasIndexedDB()) return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error('Failed to save audio cache'));
    });
  } catch (error) {
    // 保存缓存失败不阻断核心主流程，记录并忽略
    console.warn('[AudioCache] Failed to persist to IndexedDB:', error);
  }
}

export async function updateAudioCacheLastPlayed(id: string): Promise<void> {
  if (!id) return;
  const now = Date.now();
  const mem = memoryStore.get(id);
  if (mem) mem.lastPlayedAt = now;

  if (!hasIndexedDB()) return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        const record = req.result as CachedAudioRecord | undefined;
        if (record) {
          record.lastPlayedAt = now;
          store.put(record);
        }
        resolve();
      };
      req.onerror = () => resolve();
    });
  } catch {
    // 忽略时间更新失败
  }
}

export async function deleteAudioCache(id: string): Promise<boolean> {
  if (!id) return false;
  memoryStore.delete(id);
  if (!hasIndexedDB()) return true;
  try {
    const db = await openDatabase();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export async function clearAllAudioCache(): Promise<void> {
  memoryStore.clear();
  if (!hasIndexedDB()) return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error('Failed to clear audio cache'));
    });
  } catch (error) {
    console.warn('[AudioCache] Failed to clear IndexedDB:', error);
  }
}

export async function listAudioCache(limit = 200): Promise<CachedAudioRecord[]> {
  if (!hasIndexedDB()) {
    return Array.from(memoryStore.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
  try {
    const db = await openDatabase();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const items: CachedAudioRecord[] = [];
      const req = store.openCursor(null, 'prev'); // 按倒序排列，最新生成的在前
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor && items.length < limit) {
          items.push(cursor.value as CachedAudioRecord);
          cursor.continue();
        } else {
          resolve(items);
        }
      };
      req.onerror = () => {
        resolve(Array.from(memoryStore.values()).slice(0, limit));
      };
    });
  } catch {
    return Array.from(memoryStore.values()).slice(0, limit);
  }
}

export async function getAudioCacheStats(): Promise<AudioCacheStats> {
  if (!hasIndexedDB()) {
    let totalBytes = 0;
    for (const item of memoryStore.values()) {
      totalBytes += item.sizeBytes || 0;
    }
    return { count: memoryStore.size, totalBytes };
  }
  try {
    const db = await openDatabase();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      let count = 0;
      let totalBytes = 0;
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          count++;
          const val = cursor.value as CachedAudioRecord;
          totalBytes += val.sizeBytes || 0;
          cursor.continue();
        } else {
          resolve({ count, totalBytes });
        }
      };
      req.onerror = () => resolve({ count: 0, totalBytes: 0 });
    });
  } catch {
    return { count: 0, totalBytes: 0 };
  }
}
