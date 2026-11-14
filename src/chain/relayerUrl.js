const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export function resolveRelayerUrl(configured, pageHostname) {
  const raw = String(configured ?? '').trim().replace(/\/$/, '')
  if (!raw) return ''

  let url
  try {
    url = new URL(raw)
  } catch {
    return ''
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const page = String(pageHostname ?? '').replace(/^\[|\]$/g, '').toLowerCase()
  if (LOCAL_HOSTS.has(host) && !LOCAL_HOSTS.has(page)) return ''
  return raw
}
