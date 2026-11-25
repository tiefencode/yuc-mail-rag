export const CATEGORIES = ['correspondence', 'notification', 'bounce'] as const
export type Category = typeof CATEGORIES[number]

export interface CategoryInput {
  fromAddress: string | null
  autoSubmitted: string | null
  listUnsubscribe: boolean
  precedence: string | null
  contentType: string | null
}

// Only domains of companies and public bodies, and the label's own shop address; no private addresses.
const NOTIFICATION_DOMAINS = [
  'bandcamp.com',
  'booking.com',
  'cleverbridge.com',
  'dhl.com',
  'dhl.de',
  'discogs.com',
  'fedex.com',
  'google.com',
  'instagram.com',
  'paypal.com',
  'paypal.de',
  'spotify.com',
  'sumup.com',
  'sumup.de',
  'wetransfer.com',
  'winzip.com',
]
const NOTIFICATION_ADDRESSES = ['shop@youngandcold.de']
const CORRESPONDENCE_DOMAINS = [
  'audioglobe.it',
  'gema.de',
  'pakajo.world',
  'readymadedistribution.com',
]

export function categorize(message: CategoryInput): Category {
  const address = message.fromAddress?.toLowerCase() ?? ''
  const domain = address.slice(address.lastIndexOf('@') + 1)
  if (address.startsWith('mailer-daemon@') || isDeliveryReport(message.contentType))
    return 'bounce'
  if (matchesDomain(domain, CORRESPONDENCE_DOMAINS))
    return 'correspondence'
  if (NOTIFICATION_ADDRESSES.includes(address) || matchesDomain(domain, NOTIFICATION_DOMAINS))
    return 'notification'
  if (isBulk(message))
    return 'notification'
  return 'correspondence'
}

function matchesDomain(domain: string, list: string[]): boolean {
  return domain !== '' && list.some(entry => domain === entry || domain.endsWith(`.${entry}`))
}

function isDeliveryReport(contentType: string | null): boolean {
  return contentType !== null && contentType.startsWith('multipart/report') && contentType.includes('delivery-status')
}

function isBulk(message: CategoryInput): boolean {
  return (message.autoSubmitted !== null && message.autoSubmitted !== 'no')
    || message.listUnsubscribe
    || message.precedence === 'bulk'
    || message.precedence === 'list'
}
