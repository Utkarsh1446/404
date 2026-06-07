import { createApp } from './app.js'
import { serverConfig } from './config.js'

const app = createApp()

app.listen(serverConfig.port, () => {
  console.log(`SuperPumped Guess API listening on http://127.0.0.1:${serverConfig.port}`)
})
