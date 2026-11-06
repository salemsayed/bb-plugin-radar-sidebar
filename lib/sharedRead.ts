export type SharedReadStatus = "loading" | "ready" | "missing" | "error";

export interface SharedReadState<T> {
  data: T | null;
  status: SharedReadStatus;
  cached: boolean;
}

export interface SharedRead<T> {
  get(): SharedReadState<T>;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
}

export interface SharedReadOptions<T> {
  load: () => Promise<T>;
  readCache: () => T | null;
  writeCache: (data: T | null) => void;
  absent: (error: unknown) => boolean;
  refreshMs: number;
  events: readonly string[];
  key?: (data: T) => string;
}

export function createSharedRead<T>(options: SharedReadOptions<T>): SharedRead<T> {
  const listeners = new Set<() => void>();
  let state: SharedReadState<T> | null = null;
  let serialized: string | null = null;
  let pending: Promise<void> | null = null;
  let dirty = false;
  let stop: (() => void) | null = null;
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const key = options.key ?? ((data: T) => JSON.stringify(data));

  const current = () => {
    if (!state) {
      const cached = options.readCache();
      serialized = cached === null ? null : key(cached);
      state = { data: cached, status: "loading", cached: cached !== null };
    }
    return state;
  };
  const publish = (next: SharedReadState<T>) => {
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const once = async () => {
    try {
      const data = await options.load();
      failures = 0;
      const text = key(data);
      const previous = current();
      if (text === serialized && previous.data !== null) {
        if (previous.status !== "ready") publish({ data: previous.data, status: "ready", cached: false });
        return;
      }
      serialized = text;
      options.writeCache(data);
      publish({ data, status: "ready", cached: false });
    } catch (error) {
      if (options.absent(error)) {
        options.writeCache(null);
        serialized = null;
        publish({ data: null, status: "missing", cached: false });
      } else {
        publish({ ...current(), status: "error" });
        failures += 1;
        if (stop && !retry) retry = setTimeout(() => { retry = null; if (stop) void refresh(); }, Math.min(3_000 * 2 ** (failures - 1), 30_000));
      }
    }
  };
  const drain = async () => {
    while (dirty) {
      dirty = false;
      await once();
    }
    pending = null;
  };
  const refresh = () => {
    dirty = true;
    pending ??= Promise.resolve().then(drain);
    return pending;
  };
  const start = () => {
    const reload = () => void refresh();
    const timer = setInterval(reload, options.refreshMs);
    for (const event of options.events) window.addEventListener(event, reload);
    stop = () => {
      clearInterval(timer);
      if (retry) { clearTimeout(retry); retry = null; }
      for (const event of options.events) window.removeEventListener(event, reload);
      stop = null;
    };
    void refresh();
  };
  return {
    get: current,
    subscribe(listener) {
      listeners.add(listener);
      if (!stop) start();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) stop?.();
      };
    },
    refresh,
  };
}
