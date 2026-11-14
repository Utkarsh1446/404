import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const base = process.env.DEMO_URL || 'http://127.0.0.1:4173/?demo=1'
const outDir = process.env.SHOT_DIR || '/tmp/notfound-shots'
mkdirSync(outDir, { recursive: true })

const relayerCalls = []
const consoleErrors = []

async function clickLatLng(page, lat, lng) {
  const point = await page.getByTestId('guess-map').evaluate((svg, target) => {
    const x = ((target.lng + 180) / 360) * 1000
    const y = ((90 - target.lat) / 180) * 500
    const local = svg.createSVGPoint()
    local.x = x
    local.y = y
    const client = local.matrixTransform(svg.getScreenCTM())
    return { x: client.x, y: client.y }
  }, { lat, lng })
  await page.mouse.click(point.x, point.y)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('request', (request) => {
  const url = request.url()
  if (url.includes(':8788') || url.includes('127.0.0.1:8788') || url.includes('localhost:8788')) {
    relayerCalls.push(url)
  }
})
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})

await page.goto(base, { waitUntil: 'networkidle' })
await page.getByTestId('demo-banner').waitFor()
await page.getByText('WHERE IS THIS?').waitFor()
await page.getByTestId('guess-map').waitFor()
await page.getByTestId('mint-schedule').waitFor()
const photoLoaded = await page.locator('.photo img').evaluate((img) => img.complete && img.naturalWidth > 0)
if (!photoLoaded) throw new Error('Round photo did not load.')
await page.screenshot({ path: path.join(outDir, '01-board.png') })

await clickLatLng(page, 48.66, 2.55)
await page.screenshot({ path: path.join(outDir, '02-pin.png') })
await page.getByTestId('submit-guess').click()
await page.getByTestId('reward-note').getByText(/would mint \+\d+ NOTF on testnet/).waitFor()
await page.getByText('minted by contract').count().then((count) => {
  if (count) throw new Error('Demo reveal still says minted by contract.')
})
await page.screenshot({ path: path.join(outDir, '03-paid.png') })

await page.getByRole('button', { name: 'Daily drop open' }).click()
await page.getByText('WHERE IS THE DROP?').waitFor()
await clickLatLng(page, 35.4, 139.9)
await page.getByTestId('submit-guess').click()
await page.getByTestId('reward-note').getByText(/would pay \+25 NOTF from the pool|prize would stay in the pool/).waitFor()
await page.screenshot({ path: path.join(outDir, '04-drop.png') })

if (relayerCalls.length) {
  throw new Error(`Page called a relayer: ${relayerCalls.join(', ')}`)
}
const relayerNoise = consoleErrors.filter((line) => /8788|127\.0\.0\.1|localhost/.test(line))
if (relayerNoise.length) {
  throw new Error(`Console mentioned a local relayer:\n${relayerNoise.join('\n')}`)
}

console.log('wrote screenshots to', outDir)
if (consoleErrors.length) console.log('console errors:\n', consoleErrors.join('\n'))
await browser.close()
