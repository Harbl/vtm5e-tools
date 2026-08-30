import { STEPS, PRESETS, getAutomationConfig, setAutomationConfig } from './settings.js'

const MODULE_ID = 'vtm5e-automation'

/**
 * Tabbed automation-settings form (NPC / Player / General), opened via the
 * module's entry in Foundry's Settings tab (see registerSettings() in
 * settings.js). Tabs are hand-rolled (a click listener toggling `hidden` on
 * sibling panels) rather than using ApplicationV2's built-in tab-group
 * config, matching this module's established pattern elsewhere of plain
 * DOM/JS over deeper framework features - simpler to reason about and less
 * exposed to API shape changes across Foundry versions.
 *
 * All three tabs' fields stay in the DOM at all times (just hidden), so
 * `submitOnChange` always submits the complete config object regardless of
 * which tab happens to be visible when a field changes.
 */
export class AutomationSettingsApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: 'vtm5e-automation-settings',
    tag: 'form',
    window: {
      title: 'VtM5e Automation Settings',
      icon: 'fas fa-sliders-h'
    },
    position: {
      width: 560,
      height: 'auto'
    },
    form: {
      handler: AutomationSettingsApp.#onSubmitForm,
      submitOnChange: true,
      closeOnSubmit: false
    },
    actions: {
      applyPreset: AutomationSettingsApp.#onApplyPreset
    }
  }

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/automation-settings.hbs` }
  }

  async _prepareContext(_options) {
    const config = getAutomationConfig()

    const steps = Object.entries(STEPS).map(([key, def]) => ({
      key,
      label: def.label,
      hint: def.hint,
      choices: def.choices,
      npcValue: config.npc[key],
      playerValue: config.player[key]
    }))

    const presets = Object.entries(PRESETS).map(([key, def]) => ({
      key,
      label: def.label,
      hint: def.hint
    }))

    return { steps, presets }
  }

  _onRender(context, options) {
    super._onRender(context, options)

    const tabButtons = this.element.querySelectorAll('.vtm5e-automation-settings-tabs [data-tab]')
    const panels = this.element.querySelectorAll('.tab-panel[data-tab]')

    tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        tabButtons.forEach((b) => b.classList.toggle('active', b === button))
        panels.forEach((p) => { p.hidden = p.dataset.tab !== button.dataset.tab })
      })
    })
  }

  static async #onSubmitForm(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object)
    await setAutomationConfig(data.config)
  }

  static async #onApplyPreset(_event, target) {
    const preset = PRESETS[target.dataset.preset]
    if (!preset) return

    await setAutomationConfig(preset.config)
    this.render()
  }
}
