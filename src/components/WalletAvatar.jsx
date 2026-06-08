import walletAvatar from '../assets/avatars/wallet-avatar.png'

export function WalletAvatar() {
  return (
    <span className="wallet-avatar" aria-label="Wallet avatar">
      <img className="wallet-avatar-image" src={walletAvatar} alt="" aria-hidden="true" />
    </span>
  )
}
