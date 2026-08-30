import { openXPShop } from './xp-shop-app.js'

const MODULE_ID = 'vtm5e-xpshop'

Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Initializing`)

  game.modules.get(MODULE_ID).api = {
    open: openXPShop
  }
})
