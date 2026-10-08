let observer: IntersectionObserver | undefined;
const callbacks = new Map<Element, () => void>();

export function observeNearViewport(element: Element, callback: () => void) {
  if (typeof IntersectionObserver === 'undefined') {
    callback();
    return () => {};
  }
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) callbacks.get(entry.target)?.();
      }
    },
    { rootMargin: '300px' },
  );
  callbacks.set(element, callback);
  observer.observe(element);
  return () => {
    callbacks.delete(element);
    observer?.unobserve(element);
    if (!callbacks.size) {
      observer?.disconnect();
      observer = undefined;
    }
  };
}
