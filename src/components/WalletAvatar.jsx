import { useId } from 'react'

const avatarModules = import.meta.glob('../assets/avatars/faces/avatar-*.png', {
  eager: true,
  import: 'default',
  query: '?url',
})

const avatarImages = Object.entries(avatarModules)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([, source]) => source)

function hashValue(value = '') {
  return [...value].reduce((hash, char) => {
    return (hash * 31 + char.charCodeAt(0)) >>> 0
  }, 2166136261)
}

function chooseAvatar(seed) {
  if (!avatarImages.length) {
    return ''
  }

  return avatarImages[hashValue(seed) % avatarImages.length]
}

export function WalletAvatar({ value }) {
  const fallbackSeed = useId()

  const avatarSource = chooseAvatar(String(value || fallbackSeed))

  return (
    <span className="wallet-avatar" aria-label="Wallet avatar">
      <img className="wallet-avatar-image" src={avatarSource} alt="" aria-hidden="true" />
    </span>
  )
}
