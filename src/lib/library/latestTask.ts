// Keep at most one operation in flight and one replacement waiting behind it.
export function createLatestTask<T>(run: (value: T) => Promise<void>, delay = 150) {
  let pending: { value: T } | undefined;
  let running: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  async function drain() {
    while (pending) {
      const { value } = pending;
      pending = undefined;
      await run(value);
    }
  }

  function flush(): Promise<void> {
    clearTimer();
    if (!running) {
      const task = drain();
      running = task;
      void task.then(
        () => {
          if (running === task) running = undefined;
        },
        () => {
          if (running === task) running = undefined;
        },
      );
    }
    return running.then(() => (pending ? flush() : undefined));
  }

  return {
    get pending() {
      return pending !== undefined || running !== undefined;
    },
    schedule(value: T) {
      pending = { value };
      if (!running && timer === undefined)
        timer = setTimeout(() => {
          void flush();
        }, delay);
    },
    flush,
    cancel() {
      clearTimer();
      pending = undefined;
    },
  };
}
