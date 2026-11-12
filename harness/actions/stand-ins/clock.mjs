const offset = Number(process.env.PANEL_CLOCK_OFFSET_MS ?? 0);

if (offset) {
  const Real = Date;
  const now = () => Real.now() + offset;
  globalThis.Date = class Shifted extends Real {
    constructor(...args) {
      if (args.length === 0) super(now());
      else super(...args);
    }
    static now() {
      return now();
    }
  };
}
