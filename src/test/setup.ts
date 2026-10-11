import "@testing-library/jest-dom";

/**
 * Browser shims for component suites.
 *
 * Server-side suites (the /api helpers) opt into vitest's `node` environment,
 * where there is no `window` — so guard rather than crashing on import.
 */
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });

  // jsdom has no ResizeObserver; the drawing viewer uses it to track width.
  if (!("ResizeObserver" in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}
