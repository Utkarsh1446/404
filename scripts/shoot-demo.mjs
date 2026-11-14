import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const base = process.env.DEMO_URL || 'http://127.0.0.1:4173/?demo=1'
const outDir = process.env.SHOT_DIR || '/tmp/notfound-shots'
mkdirSync(outDir, { recursive: true })

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

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.goto(base, { waitUntil: 'networkidle' })
await page.getByText('WHERE IS THIS?').waitFor()
await page.getByTestId('guess-map').waitFor()
await page.screenshot({ path: path.join(outDir, '01-board.png') })

await clickLatLng(page, 48.66, 2.55)
await page.screenshot({ path: path.join(outDir, '02-pin.png') })
await page.getByTestId('submit-guess').click()
await page.getByTestId('result-distance').waitFor()
await page.screenshot({ path: path.join(outDir, '03-paid.png') })

await page.getByRole('button', { name: 'Daily drop open' }).click()
await page.getByText('WHERE IS THE DROP?').waitFor()
await clickLatLng(page, 35.4, 139.9)
await page.getByTestId('submit-guess').click()
await page.getByText('from the pool').waitFor()
await page.screenshot({ path: path.join(outDir, '04-drop.png') })

console.log('wrote screenshots to', outDir)
await browser.close()
