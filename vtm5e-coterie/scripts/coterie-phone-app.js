// Only ever dynamically imported (see main.js) after confirming
// smartphone-widget is active, so this static import of its BaseApp is
// safe - it's never reached otherwise (same soft-dependency shape as every
// other phone-app integration in this project).
import { BaseApp } from '/modules/smartphone-widget/scripts/apps/BaseApp.js'
import { CoterieApplication } from './coterie-application.js'

/**
 * The Coterie window's tabbed multi-member layout doesn't shrink to phone
 * width the way the Relationship Map's graph does (see
 * relationship-map-phone-app.js) - this is just a launch tile that pops the
 * real desktop CoterieApplication window open, promoted to the whole
 * screen since there's no scaled-down view worth building here.
 */
export class CoteriePhoneApp extends BaseApp {
  render () {
    const content = `
      <div class="vtm5e-coterie-phone-app">
        <button type="button" class="vtm5e-coterie-phone-open">
          <i class="fas fa-people-group"></i>
          <span>Open Coterie</span>
        </button>
      </div>
    `
    this.updateContent(content)
  }

  setupListeners () {
    this.removeAllListeners()
    const button = this.element.querySelector('.vtm5e-coterie-phone-open')
    this.addListener(button, 'click', () => new CoterieApplication().render(true))
  }
}
