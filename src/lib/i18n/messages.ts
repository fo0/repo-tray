import * as de from './de';
import * as en from './en';
import type { Locale } from './locale';

/** The catalog shape; German is the reference every language must match. */
export type Messages = typeof de;

export const CATALOGS: Record<Locale, Messages> = { de, en };
