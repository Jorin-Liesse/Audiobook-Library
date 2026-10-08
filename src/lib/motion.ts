import { cubicOut } from 'svelte/easing';
import { fly, type FlyParams } from 'svelte/transition';

// Check at transition time so changes to the system preference take effect immediately.
export function reveal(node: Element, options: FlyParams = {}) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return fly(node, {
    y: 8,
    duration: 220,
    easing: cubicOut,
    ...options,
    ...(reduced ? { duration: 0, delay: 0, x: 0, y: 0 } : {}),
  });
}
