import bs58 from 'bs58'
import nacl from 'tweetnacl'

const STORAGE_KEY = 'sp-guess-demo-wallet'

export function getDemoWallet() {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  let keyPair

  if (raw) {
    const secretKey = Uint8Array.from(JSON.parse(raw))
    keyPair = nacl.sign.keyPair.fromSecretKey(secretKey)
  } else {
    keyPair = nacl.sign.keyPair()
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Array.from(keyPair.secretKey)),
    )
  }

  return {
    walletAddress: bs58.encode(keyPair.publicKey),
    label: 'Demo signer',
    async signMessage(messageBytes) {
      return nacl.sign.detached(messageBytes, keyPair.secretKey)
    },
  }
}
