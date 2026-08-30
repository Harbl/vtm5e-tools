import { registerCoterieData } from './coterie-data.js'
import { CoterieApplication } from './coterie-application.js'
import { registerDirectoryButton } from './directory-button.js'

Hooks.once('init', () => {
  registerCoterieData()
  registerDirectoryButton()
})

Hooks.once('ready', () => {
  game.modules.get('vtm5e-coterie').api = {
    openCoterie: () => new CoterieApplication().render(true)
  }
})

// Optional integration: a "Coterie" app on the Smartphone Widget's home
// screen, same soft-dependency shape as vtm5e-domainmap's Relationships app.
Hooks.once('setup', async () => {
  const smartphoneApi = game.modules.get('smartphone-widget')?.api
  if (typeof smartphoneApi?.registerApp !== 'function') return

  const { CoteriePhoneApp } = await import('./coterie-phone-app.js')
  smartphoneApi.registerApp({
    id: 'vtm5e-coterie',
    name: 'Coterie',
    icon: 'fas fa-people-group',
    color: '#7a1414',
    category: 'utility',
    appClass: CoteriePhoneApp,
    defaultInstalled: true
  })
})
