import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { setupDom, type DomHandle } from '../../components/toc/__tests__/dom-setup.js';
import {
  canAnimateThemeSwitch,
  applyThemeToDom,
  runThemeTransition,
  usePreferencesStore,
} from '../usePreferencesStore.js';

let dom: DomHandle | undefined;

describe('usePreferencesStore: Anti-tearing Theme Transition', () => {
  beforeEach(async () => {
    dom = await setupDom(true);
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
  });

  afterEach(() => {
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
    dom?.teardown();
    dom = undefined;
  });

  describe('canAnimateThemeSwitch', () => {
    it('returns false when document does not support startViewTransition', () => {
      const mockDoc = {} as Document;
      const mockWin = {
        matchMedia: () => ({ matches: false }),
      } as unknown as Window;
      expect(canAnimateThemeSwitch(mockDoc, mockWin)).toBe(false);
    });

    it('returns false when user prefers reduced motion', () => {
      const mockDoc = {
        startViewTransition: () => {},
      } as unknown as Document;
      const mockWin = {
        matchMedia: () => ({ matches: true }),
      } as unknown as Window;
      expect(canAnimateThemeSwitch(mockDoc, mockWin)).toBe(false);
    });

    it('returns true when startViewTransition is available and reduced motion is disabled', () => {
      const mockDoc = {
        startViewTransition: () => {},
      } as unknown as Document;
      const mockWin = {
        matchMedia: () => ({ matches: false }),
      } as unknown as Window;
      expect(canAnimateThemeSwitch(mockDoc, mockWin)).toBe(true);
    });
  });

  describe('applyThemeToDom', () => {
    it('sets dark theme classes and attributes', () => {
      applyThemeToDom('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('light')).toBe(false);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(document.documentElement.style.colorScheme).toBe('dark');
    });

    it('sets light theme classes and attributes', () => {
      applyThemeToDom('light');
      expect(document.documentElement.classList.contains('light')).toBe(true);
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
      expect(document.documentElement.style.colorScheme).toBe('light');
    });
  });

  describe('runThemeTransition lifecycle', () => {
    it('applies .theme-transitioning during transition and cleans up via double rAF', async () => {
      const rafCallbacks: Array<(timestamp: number) => void> = [];
      const originalRaf = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = (cb: (t: number) => void) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      };

      try {
        let finishedResolve!: () => void;
        const finishedPromise = new Promise<void>((resolve) => {
          finishedResolve = resolve;
        });

        const mockStartViewTransition = (cb: () => void) => {
          cb();
          return { finished: finishedPromise };
        };

        (document as unknown as Record<string, unknown>).startViewTransition = mockStartViewTransition;

        // Stub matchMedia for prefers-reduced-motion: false
        window.matchMedia = (() => ({ matches: false })) as unknown as typeof window.matchMedia;

        let updateCalled = false;
        runThemeTransition(() => {
          updateCalled = true;
        });

        expect(updateCalled).toBe(true);
        // Immediately after triggering, .theme-transitioning must be added to root
        expect(document.documentElement.classList.contains('theme-transitioning')).toBe(true);

        // Simulate view transition completion
        finishedResolve();
        await finishedPromise;

        // First rAF
        expect(rafCallbacks.length).toBe(1);
        const firstRaf = rafCallbacks.shift()!;
        firstRaf(performance.now());

        // Second rAF scheduled
        expect(rafCallbacks.length).toBe(1);
        expect(document.documentElement.classList.contains('theme-transitioning')).toBe(true);

        const secondRaf = rafCallbacks.shift()!;
        secondRaf(performance.now());

        // After double rAF, .theme-transitioning should be safely removed
        expect(document.documentElement.classList.contains('theme-transitioning')).toBe(false);
      } finally {
        globalThis.requestAnimationFrame = originalRaf;
      }
    });

    it('falls back safely and cleans up when startViewTransition is unsupported', () => {
      const rafCallbacks: Array<(timestamp: number) => void> = [];
      const originalRaf = globalThis.requestAnimationFrame;
      globalThis.requestAnimationFrame = (cb: (t: number) => void) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      };

      try {
        delete (document as { startViewTransition?: unknown }).startViewTransition;

        let updateCalled = false;
        runThemeTransition(() => {
          updateCalled = true;
        });

        expect(updateCalled).toBe(true);
        expect(document.documentElement.classList.contains('theme-transitioning')).toBe(true);

        // Execute double rAF
        expect(rafCallbacks.length).toBe(1);
        rafCallbacks.shift()!(performance.now());
        expect(rafCallbacks.length).toBe(1);
        rafCallbacks.shift()!(performance.now());

        expect(document.documentElement.classList.contains('theme-transitioning')).toBe(false);
      } finally {
        globalThis.requestAnimationFrame = originalRaf;
      }
    });
  });

  describe('store theme toggle and idempotency', () => {
    it('toggles theme between light and dark', () => {
      usePreferencesStore.setState({ theme: 'light' });
      usePreferencesStore.getState().toggleTheme();
      expect(usePreferencesStore.getState().theme).toBe('dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

      usePreferencesStore.getState().toggleTheme();
      expect(usePreferencesStore.getState().theme).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });

    it('setTheme ignores redundant calls', () => {
      usePreferencesStore.setState({ theme: 'dark' });
      applyThemeToDom('dark');

      const classListAdd = document.documentElement.classList.add;
      let addedClass = '';
      document.documentElement.classList.add = (name: string) => {
        addedClass = name;
        return classListAdd.call(document.documentElement.classList, name);
      };

      try {
        usePreferencesStore.getState().setTheme('dark');
        // Should not re-add .theme-transitioning
        expect(addedClass).not.toBe('theme-transitioning');
      } finally {
        document.documentElement.classList.add = classListAdd;
      }
    });
  });
});

