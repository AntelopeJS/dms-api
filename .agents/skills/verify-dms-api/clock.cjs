const offset = Number(process.env.VERIFY_API_CLOCK_OFFSET_MS ?? "0");
const RealDate = Date;

/** A `Date` whose "now" runs `VERIFY_API_CLOCK_OFFSET_MS` ahead of the machine's, so an hourly job fires within seconds. */
class ShiftedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(RealDate.now() + offset);
    else super(...args);
  }

  static now() {
    return RealDate.now() + offset;
  }
}

if (offset !== 0) globalThis.Date = ShiftedDate;
