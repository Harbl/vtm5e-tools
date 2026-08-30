// Optional integration with the GlitchSmith Library module (glitchsmith-lib) - registers
// our Cash on Hand flag as a Sheet Currency preset for the wod5e system, so a GM running
// glitchsmith-lib can enable it from Configure Currencies without hand-typing the actor
// path. This is a pure registration: it does not read/write currency itself, and stays a
// safe no-op if glitchsmith-lib isn't installed (the hook below simply never fires).
//
// Per glitchsmith-lib's docs, "registerSystemPresets" must be registered at module-file
// evaluation time (top level, as below) rather than inside our own init hook - the
// Library fires it during ITS OWN init callback, so a late registration can miss it.
Hooks.once('glitchsmith-lib.registerSystemPresets', ({ register }) => {
  register('wod5e', {
    base: 'cash',
    currencies: {
      cash: {
        name: 'Dollars',
        symbol: '$',
        rate: 1,
        type: 'sheet',
        actorPath: 'flags.vtm5e-charactersheet.currency',
        primary: true,
        integer: false,
        precision: 2
      }
    }
  })
})
