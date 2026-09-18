import '@testing-library/jest-dom/vitest';

/**
 * jsdom does not implement PointerEvent, and the timeline brush is built on
 * pointer events. Without this, fireEvent.pointerDown produces a bare Event
 * that carries no clientX and the brush tests would silently measure nothing.
 *
 * A PointerEvent is a MouseEvent with a few extra fields, which is all the
 * brush reads, so extending MouseEvent is enough.
 */
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    readonly isPrimary: boolean;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}
