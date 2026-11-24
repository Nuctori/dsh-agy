/**
 * Node → region, for keeping an account's egress in ONE country.
 *
 * Google scores an account's location rather than a single request's: current
 * IP, the account's login history and its usual region all feed the same
 * decision. A rotation that hops Hong Kong → Japan → Singapore on consecutive
 * failures therefore looks like travel nobody booked, which is exactly the
 * signal the community reports before a soft block.
 *
 * The region is derived from the node LABEL because that is all a subscription
 * gives us: flag emoji first, then the common Chinese and English names. An
 * unrecognised label returns undefined, and callers then fall back to plain
 * ranking — guessing a region from a random token would be worse than not
 * knowing.
 */

const REGION_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/🇭🇰|香港|\bhk\b|hong ?kong/i, 'HK'],  [/🇯🇵|日本|东京|大阪|\bjp\b|japan|tokyo|osaka/i, 'JP'],
  [/🇸🇬|新加坡|狮城|\bsg\b|singapore/i, 'SG'],
  [/🇺🇸|美国|西美|美西|\bus\b|usa|united states|america|los angeles|seattle/i, 'US'],
  [/🇬🇧|英国|伦敦|\buk\b|united kingdom|london/i, 'GB'],
  [/🇰🇷|韩国|首尔|\bkr\b|korea|seoul/i, 'KR'],
  [/🇲🇾|马来|吉隆坡|\bmy\b|malaysia|kuala/i, 'MY'],
  [/🇹🇼|台湾|台北|\btw\b|taiwan|taipei/i, 'TW'],
  [/🇹🇭|泰国|曼谷|\bth\b|thailand|bangkok/i, 'TH'],
  [/🇩🇪|德国|法兰克福|\bde\b|germany|frankfurt/i, 'DE'],
  [/🇫🇷|法国|巴黎|\bfr\b|france|paris/i, 'FR'],
  [/🇳🇱|荷兰|阿姆斯特丹|\bnl\b|netherlands|amsterdam/i, 'NL'],
  [/🇨🇦|加拿大|\bca\b|canada/i, 'CA'],
  [/🇦🇺|澳大利亚|澳洲|悉尼|\bau\b|australia|sydney/i, 'AU'],
  [/🇮🇳|印度|\bin\b|india/i, 'IN'],
  [/🇷🇺|俄罗斯|莫斯科|\bru\b|russia|moscow/i, 'RU'],
]

/** Region code for a node label, or undefined when the label says nothing. */
export function regionOfNode(name: string): string | undefined {
  for (const [pattern, region] of REGION_PATTERNS) {
    if (pattern.test(name)) return region
  }
  return undefined
}

/**
 * Regions where the Antigravity/Gemini surface is NOT offered.
 *
 * A node in one of these does not merely perform badly: the request is rejected
 * on availability grounds, and repeatedly presenting a blocked region for an
 * account is itself a signal. The list is the conservative intersection of the
 * regions Google's consumer AI surface does not serve; anything not named here
 * is treated as usable.
 */
const UNSUPPORTED_REGIONS: ReadonlySet<string> = new Set([
  'HK', // Hong Kong — Google's AI surface is not offered here (measured: 400
        // FAILED_PRECONDITION "User location is not supported for the API use")
  'MO', // Macau
  'CN', // mainland China
  'RU', // Russia
  'IR', // Iran
  'KP', // North Korea
  'SY', // Syria
  'CU', // Cuba
  'BY', // Belarus
])

/** Whether a region code is served at all. Unknown labels are NOT filtered. */
export function isRegionSupported(region: string | undefined): boolean {
  if (region === undefined) return true
  return !UNSUPPORTED_REGIONS.has(region)
}

/** Whether a node label names a region that is not served. */
export function isNodeUnsupported(name: string): boolean {
  return !isRegionSupported(regionOfNode(name))
}

/**
 * Locale → the region an account probably belongs in.
 *
 * Google exposes no location, but `userinfo.locale` is a strong hint (`hi` ⇒
 * India, `ja` ⇒ Japan). Mapped onto the regions this plugin can name; an
 * unsupported-or-unknown locale returns undefined and the caller falls back to
 * whatever the user chose.
 */
export function regionForLocale(locale: string | undefined): string | undefined {
  if (locale === undefined || locale === '') return undefined
  const language = locale.toLowerCase().split(/[-_]/)[0] ?? ''
  const region = locale.toUpperCase().split(/[-_]/)[1]
  // A supported explicit region wins over the language default (en-GB ⇒ GB).
  if (region !== undefined && region.length === 2 && region !== 'HK' && region !== 'MO'
    && /^[A-Z]{2}$/.test(region) && !UNSUPPORTED_REGIONS.has(region)) {
    return region
  }
  return LOCALE_TO_REGION[language]
}

/** Language → the region most accounts with that locale sit in. */
const LOCALE_TO_REGION: Readonly<Record<string, string>> = {
  hi: 'IN',
  bn: 'IN',
  ta: 'IN',
  te: 'IN',
  mr: 'IN',
  ja: 'JP',
  ko: 'KR',
  th: 'TH',
  vi: 'VN',
  id: 'ID',
  ms: 'MY',
  tl: 'PH',
  en: 'US',
  es: 'ES',
  pt: 'BR',
  fr: 'FR',
  de: 'DE',
  it: 'IT',
  nl: 'NL',
  pl: 'PL',
  tr: 'TR',
  ar: 'AE',
  he: 'IL',
  fa: 'TR', // Iran is not served; Turkey is the nearest served neighbour
  ru: 'KZ', // Russia is not served; Kazakhstan is the nearest served neighbour
  uk: 'PL',
  zh: 'TW', // mainland China and Hong Kong are not served
}
