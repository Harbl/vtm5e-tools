// A small crown button on the Actors sidebar's folder header row(s) -
// Pathfinder party-sheet-module-inspired, per Jake's ask - so opening the
// Coterie window never needs Smartphone Widget installed at all. The phone
// app tile (coterie-phone-app.js) stays as a nice-to-have on top of this
// for anyone who does run Smartphone Widget; this is the real primary entry
// point for the public bundle.
//
// Only appears on folders that actually contain at least one player-owned
// actor - a generic "this looks like a PC folder" heuristic rather than a
// hardcoded folder name, so it doesn't clutter unrelated folders (Shops,
// NPCs, etc) and needs no GM setup to show up in the right place.
//
// Confirmed against the real installed folder-partial.hbs on the sandbox:
// each folder row is `<li class="directory-item folder" data-folder-id="...">`
// wrapping a `<header class="folder-header" data-action="toggleFolder">` -
// appending our button there, not inside the .subdirectory content area.

export function registerDirectoryButton () {
  Hooks.on('renderActorDirectory', (_app, html) => {
    const root = html instanceof HTMLElement ? html : html[0]
    if (!root) return

    root.querySelectorAll('.directory-item.folder').forEach((li) => {
      const header = li.querySelector(':scope > .folder-header')
      if (!header || header.querySelector('.vtm5e-coterie-open-btn')) return

      const folder = game.folders.get(li.dataset.folderId)
      const hasPlayerActor = folder?.contents?.some((a) => a.hasPlayerOwner)
      if (!hasPlayerActor) return

      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'vtm5e-coterie-open-btn icon'
      button.dataset.tooltip = 'Open Coterie'
      button.innerHTML = '<i class="fas fa-crown"></i>'
      button.addEventListener('click', (event) => {
        event.stopPropagation() // don't also toggle the folder open/closed
        game.modules.get('vtm5e-coterie')?.api?.openCoterie()
      })
      header.appendChild(button)
    })
  })
}
