export const DEMO_BANNER = 'DEMO · no relayer · this pin is scored in the browser and does not mint'
export const WOULD_BURN_NOTE = 'would burn 10 NOTF on testnet'
export const BURNED_NOTE = 'burned 10 NOTF on testnet'
export const SAMPLE_ROUND_NOTE = 'sample round · not this pin'
export const PHOTO_FALLBACK_CHIP = 'Photo fallback · no Street View key'
export const NO_BURN_TX = 'no burn tx on this deployment'

export function wouldMintNote(reward) {
  return `would mint +${reward} NOTF on testnet`
}

export function wouldPayNote(won) {
  return won ? 'would pay +25 NOTF from the pool' : 'prize would stay in the pool'
}

export function settledExampleLabel(reward) {
  return `settled example +${reward} NOTF`
}
