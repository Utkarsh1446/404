import { createApp } from './app.js'
import { serverConfig } from './config.js'

const app = createApp()

app.listen(serverConfig.port, () => {
  console.log(`notfound API listening on http://127.0.0.1:${serverConfig.port}`)
  if (serverConfig.dropAutomationEnabled) {
    app.locals.gameService.startDropAutomation({
      intervalMs: serverConfig.dropAutomationIntervalMs,
    })
  }
})
