import { createJSONStorage, type StateStorage } from 'zustand/middleware';

/**
 * Creates a Zustand storage with automatic migration from legacy localStorage keys.
 * If the current key is not found, it checks the legacy keys in order, copies the value
 * to the new key, and returns it.
 */
export function createMigratedStorage<S>(legacyKeys: string[] = []): ReturnType<typeof createJSONStorage<S>> {
  const fallbackStorage: StateStorage = {
    getItem: (name: string): string | null => {
      try {
        const current = localStorage.getItem(name);
        if (current !== null) return current;
        for (const legacyKey of legacyKeys) {
          const legacy = localStorage.getItem(legacyKey);
          if (legacy !== null) {
            try {
              localStorage.setItem(name, legacy);
            } catch {
              // Ignore storage write quota errors during read
            }
            return legacy;
          }
        }
      } catch {
        // Fallback for non-browser environments or blocked storage
      }
      return null;
    },
    setItem: (name: string, value: string): void => {
      try {
        localStorage.setItem(name, value);
      } catch {
        // Ignore quota errors
      }
    },
    removeItem: (name: string): void => {
      try {
        localStorage.removeItem(name);
      } catch {
        // Ignore
      }
    },
  };

  return createJSONStorage<S>(() => fallbackStorage);
}

