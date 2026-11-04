import { type Currency, currency, inCurrency, toShown } from "./currency";
import { intlLocale, strings } from "./i18n";
import type { Failure, FmDate, GameInfo, Storefront } from "./types";

export const STOREFRONTS: Record<Storefront, string> = strings.game.storefronts;

/** "FM27 · Game Pass 0.9.2355.0", "FM27 · Steam build 26227640" */
export function describeGame(game: GameInfo): string {
  const edition = game.edition ? `FM${game.edition}` : strings.game.name;
  const version = game.packageVersion
    ? ` ${game.packageVersion}`
    : game.steamBuild
      ? ` ${strings.game.steamBuild(game.steamBuild)}`
      : "";
  return `${edition} · ${STOREFRONTS[game.storefront]}${version}`;
}

const integers = new Intl.NumberFormat(intlLocale);

/**
 * A number with the thousands separators of the language ("12,345" in English, "12.345" in Turkish); `options` are
 * those of `Intl.NumberFormat`, e.g. for decimals.
 */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return (options ? new Intl.NumberFormat(intlLocale, options) : integers).format(value);
}

const percents = new Intl.NumberFormat(intlLocale, { style: "percent" });

/**
 * A percentage (87 for 87%) the way the language writes it: "87%" in English, "%87" in Turkish, without decimals;
 * `options` are those of `Intl.NumberFormat`, e.g. to keep some.
 */
export function formatPercent(percent: number, options?: Intl.NumberFormatOptions): string {
  const format = options ? new Intl.NumberFormat(intlLocale, { ...options, style: "percent" }) : percents;
  return format.format(percent / 100);
}

const dates = new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const daysOfYear = new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short", timeZone: "UTC" });

const utcOf = (date: FmDate) => new Date(Date.UTC(date.year, date.month - 1, date.day));

/** "26 Mar 1982" in English, "26 Eyl 1982" in Turkish: the date as the language writes it; nothing for no date. */
export function formatDate(date: FmDate | null): string {
  if (!date) {
    return "";
  }
  return dates.format(utcOf(date));
}

/**
 * Two dates as a range, "8 Aug – 22 Aug 2026" (the first without its year when both are in the same one). The same
 * day, or only one date known, is that date alone; nothing for no date.
 */
export function formatDateRange(from: FmDate | null, to: FmDate | null): string {
  if (!from || !to || (from.year === to.year && from.month === to.month && from.day === to.day)) {
    return formatDate(from ?? to);
  }
  return `${from.year === to.year ? daysOfYear.format(utcOf(from)) : formatDate(from)} – ${formatDate(to)}`;
}

/** A moment (milliseconds since 1970) as the local time of day, "14:05:09". */
export function formatTime(ms: number): string {
  const time = new Date(ms);
  return [time.getHours(), time.getMinutes(), time.getSeconds()].map((part) => String(part).padStart(2, "0")).join(":");
}

/** A moment (milliseconds since 1970) as the local date and time, the way the language writes both. */
export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(intlLocale);
}

/**
 * The message of a failed call in the language of the window. A Rust command fails with a code, the values its
 * message names and an English message (see `Failure`): the dictionary words the codes it knows (`errors` in
 * i18n/en.ts), with the numbers and dates written the language's way, and any other code keeps the English message.
 */
export function describeError(error: unknown): string {
  if (isFailure(error)) {
    const say = strings.errors[error.code];
    // The Rust side words its messages as clauses ("the player is on loan; ..."); here they stand on their own.
    return say ? say(readableParams(error.params)) : error.message.charAt(0).toUpperCase() + error.message.slice(1);
  }
  return error instanceof Error ? error.message : String(error);
}

/** The code of a failed call (see `Failure`), such as "move.noRoom"; null for any other error. */
export function errorCode(error: unknown): string | null {
  return isFailure(error) ? error.code : null;
}

function isFailure(value: unknown): value is Failure {
  return typeof value === "object" && value !== null && "code" in value && "params" in value && "message" in value;
}

/** The parameters of a failure that are amounts or field values, rather than ids. */
const VALUE_PARAMS = ["value", "min", "max", "wrote", "read", "expected", "found", "count", "limit", "players"];

/** The fields the game stores as 0–10000 for 0–100% (see `EditField.scale`), which the app shows as percentages. */
const PERCENT_FIELDS: ReadonlySet<string> = new Set(["condition", "match_sharpness"]);

/**
 * A failure's parameters as a sentence shows them: amounts with the language's separators, the values of a date field
 * (stored as numbers like 20290630) as dates, and those of a percentage as percentages: the game may have changed
 * them since they were written, and "Energy is now 95%, not 100%" says more than "now 9512, not 10000". Field keys
 * stay keys; the dictionary names them.
 */
function readableParams(params: Record<string, string>): Record<string, string> {
  const readable = { ...params };
  const dates = params.field?.endsWith("expires") ?? false;
  const percent = params.field !== undefined && PERCENT_FIELDS.has(params.field);
  for (const key of VALUE_PARAMS) {
    const value = Number(params[key]);
    if (params[key] === undefined || !Number.isFinite(value)) {
      continue;
    }
    const year = Math.floor(value / 10_000);
    const date = dates ? formatDate({ year, month: Math.floor(value / 100) % 100, day: value % 100 }) : "";
    readable[key] =
      dates && year > 1900
        ? date
        : percent
          ? formatPercent(value / 100, { maximumFractionDigits: 2 })
          : formatNumber(value);
  }
  return readable;
}

/**
 * An amount in the chosen currency (see `currency.ts`) the way the language writes it: "£1,234,567" in English,
 * "1.234.567 €" in Spanish, "-£1,234" for a club's overdraft. Whole units, unless `options` ask for decimals.
 */
export function formatAmount(shown: number, options?: Intl.NumberFormatOptions): string {
  return moneyFormat(options).format(shown);
}

function moneyFormat(options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  return new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
    ...options,
  });
}

/**
 * An amount the game keeps, in pounds, as the app shows it: in the chosen currency (see `formatAmount`), rounded as
 * money inputs round it, or with the decimals `options` ask for, such as a ticket price's.
 */
export function formatMoney(pounds: number, options?: Intl.NumberFormatOptions): string {
  return formatAmount(options ? inCurrency(pounds) : toShown(pounds), options);
}

/** The sign of a currency as the language writes it: "£", "€", "$", "₺". */
export function currencySymbolOf(code: Currency): string {
  return (
    new Intl.NumberFormat(intlLocale, { style: "currency", currency: code, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? code
  );
}

/** The sign of the chosen currency, which money inputs carry. */
export const currencySymbol: string = currencySymbolOf(currency);

/** The name of the chosen currency, or of `code`, in the language in use: "Euro", "Türk Lirası". */
export function currencyName(code: Currency = currency): string {
  try {
    return new Intl.DisplayNames(intlLocale, { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Lower-cases and strips accents, matching the Rust side's `fold`. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .replace(/[øØ]/g, "o")
    .replace(/[łŁ]/g, "l")
    .replace(/[đĐ]/g, "d")
    .replace(/ß/g, "ss")
    .toLowerCase();
}
