import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { places } from '../shared/places.js'

const base = process.env.DEMO_URL || 'http://127.0.0.1:4173/?demo=1'
const outDir = process.env.SHOT_DIR || '/tmp/notfound-shots'
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.goto(base, { waitUntil: 'networkidle' })
await page.getByText('Token').waitFor({ timeout: 15000 }).catch(() => {})
await page.screenshot({ path: path.join(outDir, '01-home.png') })

await page.getByTestId('play-button').click()
await page.getByTestId('guess-map').waitFor()
const map = await page.getByTestId('guess-map').boundingBox()
const place = places[0]
const lat = place.lat + 0.08
const lng = place.lng
const x = map.x + ((lng + 180) / 360) * map.width
const y = map.y + ((90 - lat) / 180) * map.height
await page.mouse.click(x, y)
await page.screenshot({ path: path.join(outDir, '02-guess.png') })
await page.getByTestId('submit-guess').click()
await page.getByTestId('result-distance').waitFor()
await page.screenshot({ path: path.join(outDir, '03-result.png') })

await page.getByTestId('nav-drops').click()
await page.getByTestId('guess-map').waitFor()
const dropMap = await page.getByTestId('guess-map').boundingBox()
const dropPlace = places[(1 + 1) % places.length]
const dx = dropMap.x + ((dropPlace.lng + 180) / 360) * dropMap.width
const dy = dropMap.y + ((90 - dropPlace.lat) / 180) * dropMap.height
await page.mouse.click(dx, dy)
await page.getByTestId('submit-drop').click()
await page.getByTestId('drop-distance').waitFor()
await page.screenshot({ path: path.join(outDir, '04-drop.png') })

console.log('wrote screenshots to', outDir)
await browser.close()
