import AppKit

Preferences.registerDefaults()

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
// Decided before the run loop starts, so menu-bar mode never flashes a Dock
// icon on launch. `AppDelegate.applyIconMode` handles switching later.
app.setActivationPolicy(Preferences.useMenuBarIcon ? .accessory : .regular)
app.run()
