import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

/**
 * Amounts use Western digits even in Arabic: Saudi fintech UIs (urpay
 * included) present numerals that way, and Eastern Arabic numerals would look
 * wrong next to a SAR amount.
 */
export function formatAmount(value: number | null, currency: string, lang: string) {
  if (value == null) return '';
  const n = new Intl.NumberFormat(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', {
    maximumFractionDigits: 0,
  }).format(value);
  return lang === 'ar' ? `${n} ${currency === 'SAR' ? 'ريال' : currency}` : `${currency} ${n}`;
}
