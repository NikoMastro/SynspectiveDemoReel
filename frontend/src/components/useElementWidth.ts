import { useEffect, useState } from 'react';

/**
 * Track an element's width so the timeline can lay itself out in pixels.
 *
 * The chart is drawn with explicit x positions, so it needs a number rather
 * than a CSS percentage. ResizeObserver is missing in jsdom, hence the guard:
 * in tests the fallback width is used and the layout is still deterministic.
 */
export function useElementWidth(
  ref: React.RefObject<HTMLElement | null>,
  fallback: number,
): number {
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      if (measured > 0) setWidth(measured);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
