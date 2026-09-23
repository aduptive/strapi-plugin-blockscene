import { useIntl } from 'react-intl'
import en from './translations/en.json'
import ptBR from './translations/pt-BR.json'
import pt from './translations/pt.json'
import fr from './translations/fr.json'
import es from './translations/es.json'
import de from './translations/de.json'
import it from './translations/it.json'
import nl from './translations/nl.json'

// One flat catalogue per admin UI locale (keys as in en.json, "group.item" for
// grouped options). English is the source of truth and the fallback: the admin
// merges plugin messages under `block-picker.<key>` and react-intl falls back to
// the English defaultMessage for any key or locale that is missing. Locales the
// admin offers but that have no catalogue here therefore show English.
export const PLUGIN_ID = 'block-picker'
export const TRANSLATIONS: Record<string, Record<string, string>> = { en, 'pt-BR': ptBR, pt, fr, es, de, it, nl }
const prefix = (data: Record<string, string>) => Object.fromEntries(Object.entries(data).map(([key, value]) => [`${PLUGIN_ID}.${key}`, value]))
// Strapi (4 and 5) calls this with the locales enabled in the host's admin config; only those are returned.
export const registerTrads = async ({ locales }: { locales: string[] }) =>
  locales.map(locale => ({ locale, data: prefix(TRANSLATIONS[locale] || {}) }))

type Catalogue = typeof en
type Grouped = { [K in keyof Catalogue as K extends `${infer G}.${string}` ? G : never]: Record<string, string> }
type Flat = { [K in keyof Catalogue as K extends `${string}.${string}` ? never : K]: string }
export type Messages = Flat & Grouped & { f: (key: keyof Catalogue, values: Record<string, string | number>) => string; locale: string }
// Resolves every key through the admin's IntlProvider (the user's chosen UI locale, not the browser's).
export function useMessages(): Messages {
  const { formatMessage, locale } = useIntl()
  const out: any = { locale, f: (key: keyof Catalogue, values: Record<string, string | number>) => formatMessage({ id: `${PLUGIN_ID}.${key}`, defaultMessage: en[key] }, values) }
  for (const [key, defaultMessage] of Object.entries(en)) {
    const value = formatMessage({ id: `${PLUGIN_ID}.${key}`, defaultMessage })
    const [group, item] = key.split('.')
    if (item) (out[group] ||= {})[item] = value
    else out[key] = value
  }
  return out
}
