const MODULE_ID = 'vtm5e-automation'
const RESOLVED_FLAG = 'opposedRollResolved'

/**
 * Watches wod5e's existing Roll Prompt messages (created via the Roll Menu's
 * "Prompt in Chat" against exactly two selected tokens) and, once both
 * participants have rolled, computes and displays a winner/margin.
 *
 * Deliberately reuses wod5e's own promptedRolls/isRollPrompt infrastructure
 * rather than inventing a separate correlation mechanism - this is exactly
 * what that feature already collects, it just never had resolution logic
 * layered on top of it.
 */
export function registerOpposedRollResolution() {
  Hooks.on('renderChatMessageHTML', async (message, html) => {
    const isRollPrompt = message.getFlag('wod5e', 'isRollPrompt')
    if (!isRollPrompt) return

    // Only handle 1v1 contests - group roll prompts (3+ participants) are a
    // different use case (e.g. "everyone roll perception") and aren't a
    // contest to resolve a winner for.
    const promptedRolls = message.getFlag('wod5e', 'promptedRolls') || {}
    const participants = Object.entries(promptedRolls)
    if (participants.length !== 2) return

    const [a, b] = participants
    const [aId, aData] = a
    const [bId, bData] = b

    if (!aData.rolled || !bData.rolled) return

    // Don't re-resolve/re-announce on every re-render of the same message
    if (message.getFlag(MODULE_ID, RESOLVED_FLAG)) {
      renderResolution(html, aData, bData)
      return
    }

    const aTotal = aData.roll?.total ?? 0
    const bTotal = bData.roll?.total ?? 0
    const margin = Math.abs(aTotal - bTotal)

    let winnerId = null
    if (aTotal > bTotal) winnerId = aId
    else if (bTotal > aTotal) winnerId = bId
    // else: tie, winnerId stays null

    if (message.isOwner) {
      await message.setFlag(MODULE_ID, RESOLVED_FLAG, { winnerId, margin })
    }

    renderResolution(html, aData, bData)
  })
}

function renderResolution(html, aData, bData) {
  if (html.querySelector('.vtm5e-automation-opposed-result')) return

  const aTotal = aData.roll?.total ?? 0
  const bTotal = bData.roll?.total ?? 0
  const margin = Math.abs(aTotal - bTotal)

  const resultLine = document.createElement('div')
  resultLine.classList.add('vtm5e-automation-opposed-result')
  resultLine.style.marginTop = '4px'
  resultLine.style.fontWeight = 'bold'

  if (aTotal === bTotal) {
    resultLine.textContent = `Tied at ${aTotal} successes each.`
  } else {
    const winnerName = aTotal > bTotal ? aData.actor?.name : bData.actor?.name
    resultLine.textContent = `${winnerName} wins by margin ${margin} (${aTotal} vs ${bTotal}).`
  }

  html.appendChild(resultLine)
}
