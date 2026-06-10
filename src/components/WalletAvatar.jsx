const TAPBACK_AVATAR_BASE_URL = 'https://tapback.co/api/avatar'

function getAvatarName(value) {
  const normalized = String(value || 'superpumped-player')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'superpumped-player'
}

export function WalletAvatar({ value }) {
  const avatarName = getAvatarName(value)
  const avatarSource = `${TAPBACK_AVATAR_BASE_URL}/${encodeURIComponent(avatarName)}.webp`

  return (
    <span className="wallet-avatar" aria-label="Wallet avatar">
      <img className="wallet-avatar-image" src={avatarSource} alt="" aria-hidden="true" />
    </span>
  )
}
