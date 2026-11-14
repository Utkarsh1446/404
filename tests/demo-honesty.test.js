import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BURNED_NOTE,
  DEMO_BANNER,
  NO_BURN_TX,
  PHOTO_FALLBACK_CHIP,
  SAMPLE_ROUND_NOTE,
  WOULD_BURN_NOTE,
  settledExampleLabel,
  wouldMintNote,
  wouldPayNote,
} from '../src/chain/copy.js'
import { resolveRelayerUrl } from '../src/chain/relayerUrl.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) walk(full, found)
    else if (/\.(js|jsx)$/.test(name)) found.push(full)
  }
  return found
}

test('demo labels match the strings a judge is told to look for', () => {
  assert.equal(DEMO_BANNER, 'DEMO · no relayer · this pin is scored in the browser and does not mint')
  assert.equal(wouldMintNote(15), 'would mint +15 NOTF on testnet')
  assert.equal(wouldMintNote(0), 'would mint +0 NOTF on testnet')
  assert.equal(WOULD_BURN_NOTE, 'would burn 10 NOTF on testnet')
  assert.equal(BURNED_NOTE, 'burned 10 NOTF on testnet')
  assert.equal(wouldPayNote(true), 'would pay +25 NOTF from the pool')
  assert.equal(wouldPayNote(false), 'prize would stay in the pool')
  assert.equal(settledExampleLabel(15), 'settled example +15 NOTF')
  assert.equal(SAMPLE_ROUND_NOTE, 'sample round · not this pin')
  assert.equal(PHOTO_FALLBACK_CHIP, 'Photo fallback · no Street View key')
  assert.equal(NO_BURN_TX, 'no burn tx on this deployment')
})

test('an empty or public-page localhost relayer URL never becomes a request', () => {
  assert.equal(resolveRelayerUrl('', 'notf-404-near.pages.dev'), '')
  assert.equal(resolveRelayerUrl(undefined, 'notf-404-near.pages.dev'), '')
  assert.equal(resolveRelayerUrl('   ', 'localhost'), '')
  assert.equal(resolveRelayerUrl('http://127.0.0.1:8788', 'notf-404-near.pages.dev'), '')
  assert.equal(resolveRelayerUrl('http://localhost:8788/', 'notf-404-near.pages.dev'), '')
  assert.equal(resolveRelayerUrl('http://127.0.0.1:8788', '127.0.0.1'), 'http://127.0.0.1:8788')
  assert.equal(resolveRelayerUrl('http://localhost:8788/', 'localhost'), 'http://localhost:8788')
  assert.equal(
    resolveRelayerUrl('https://notf-relayer.example.workers.dev', 'notf-404-near.pages.dev'),
    'https://notf-relayer.example.workers.dev',
  )
  assert.equal(resolveRelayerUrl('not a url', 'localhost'), '')
})

test('browser source does not call the localhost relayer', () => {
  const offenders = []
  for (const file of walk(path.join(root, 'src'))) {
    const source = readFileSync(file, 'utf8')
    if (source.includes('127.0.0.1:8788') || source.includes('localhost:8788')) {
      offenders.push(path.relative(root, file))
    }
  }
  assert.deepEqual(offenders, [])
})
