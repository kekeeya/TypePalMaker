import AppKit
import ImageIO
import TypePalCore

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private var pet: PetController?
    private var statusItem: NSStatusItem?
    private var settings: SettingsWindowController?
    private var statusIconSource: (manifest: PetManifest, directory: URL)?

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard let directory = Self.petDirectory() else {
            fail(Strings.petDataMissing)
            return
        }

        ManifestError.prefersChinese = { AppLanguage.current == .chinese }
        let manifest: PetManifest
        do {
            manifest = try PetManifest.load(from: directory)
        } catch {
            fail(Strings.petDataInvalid("\(error)"))
            return
        }

        let pet = PetController(manifest: manifest, directory: directory)
        let missing = pet.unreadableFrameIDs
        guard missing.isEmpty else {
            fail(Strings.framesUnreadable(missing.joined(separator: ", ")))
            return
        }

        let settings = SettingsWindowController(pet: pet)
        pet.menuProvider = { [unowned pet] in
            PetMenu.contextActions(pet: pet, openSettings: settings.show)
        }
        settings.onIconModeChanged = { [weak self, weak settings] in
            self?.applyIconMode()
            // Changing the activation policy deactivates the app and can send
            // the settings window behind others; bring it back.
            settings?.show()
        }
        settings.onLanguageChanged = { [weak self] in
            self?.installMainMenu()
        }
        self.pet = pet
        self.settings = settings
        statusIconSource = (manifest, directory)
        installMainMenu()
        applyIconMode()
        pet.start()
        debugLog("loaded \(manifest.name) from \(directory.path)")
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    // MARK: Dock

    /// Clicking the Dock icon brings a hidden pet back, and otherwise opens the
    /// settings — the two things a click there could reasonably mean.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        guard let pet, let settings else { return false }
        if pet.isVisible {
            settings.show()
        } else {
            pet.setVisible(true)
        }
        return false
    }

    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        guard let pet, let settings else { return nil }
        return PetMenu.dock(pet: pet, openSettings: settings.show)
    }

    // MARK: Icon mode

    /// Dock icon by default, like any app. "图标常驻：菜单栏" swaps it for a menu
    /// bar icon and drops out of the Dock. Exactly one of
    /// the two is ever present, so the pet can always be reached.
    private func applyIconMode() {
        if Preferences.useMenuBarIcon {
            NSApp.setActivationPolicy(.accessory)
            if statusItem == nil, let source = statusIconSource {
                createStatusItem(manifest: source.manifest, directory: source.directory)
            }
        } else {
            if let statusItem {
                NSStatusBar.system.removeStatusItem(statusItem)
            }
            statusItem = nil
            NSApp.setActivationPolicy(.regular)
        }
    }

    /// Rebuilt on a language switch; the Dock, status and context menus are
    /// rebuilt on every open anyway.
    private func installMainMenu() {
        guard let pet, let settings else { return }
        NSApp.mainMenu = Self.mainMenu(name: pet.manifest.name, openSettings: settings.show)
    }

    /// The app menu shown while TypePal is frontmost in Dock mode.
    static func mainMenu(name: String, openSettings: @escaping () -> Void) -> NSMenu {
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu(title: name)
        appMenu.addItem(withTitle: Strings.about(name), action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        let settingsItem = ActionMenuItem(Strings.settingsEllipsis, icon: MenuIcon.settings, handler: openSettings)
        settingsItem.keyEquivalent = ","
        appMenu.addItem(settingsItem)
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: Strings.hideApp(name), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: Strings.quit(name), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        // Without an Edit menu, ⌘C and ⌘A have nothing to route through and
        // text in the settings window cannot be copied.
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: Strings.editMenu)
        editMenu.addItem(withTitle: Strings.copy, action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: Strings.selectAll, action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        main.addItem(editItem)

        // ⌘W for the settings window.
        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: Strings.windowMenu)
        windowMenu.addItem(withTitle: Strings.closeWindow, action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu
        main.addItem(windowItem)

        return main
    }

    // MARK: Menu bar

    /// Only in menu-bar mode, where it replaces the Dock icon as the way back
    /// once the pet is hidden or set to ignore the mouse.
    private func createStatusItem(manifest: PetManifest, directory: URL) {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = item.button {
            button.image = Self.statusIcon(manifest: manifest, directory: directory)
            button.imageScaling = .scaleProportionallyDown
            button.setAccessibilityLabel(manifest.name)
        }
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        statusItem = item
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        guard let pet, let settings else { return }
        menu.removeAllItems()
        PetMenu.statusBar(pet: pet, openSettings: settings.show).forEach(menu.addItem)
    }

    /// The menu bar shows the same picture as the Dock and Finder: the app
    /// icon the Maker made (`AppIcon.icns`). Only a pet run without one —
    /// straight from a folder while developing — falls back to its first
    /// idle frame.
    private static func statusIcon(manifest: PetManifest, directory: URL) -> NSImage? {
        if Bundle.main.object(forInfoDictionaryKey: "CFBundleIconFile") != nil,
           let icon = NSApp.applicationIconImage?.copy() as? NSImage {
            icon.size = NSSize(width: 18, height: 18)
            return icon
        }
        guard let id = manifest.playable(.idle)?.frames.first?.id,
              let file = manifest.frames[id]?.file,
              let source = CGImageSourceCreateWithURL(directory.appendingPathComponent(file) as CFURL, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceThumbnailMaxPixelSize: 44
              ] as CFDictionary)
        else { return nil }
        let size = NSSize(width: 18, height: 18 * CGFloat(image.height) / CGFloat(max(image.width, 1)))
        return NSImage(cgImage: image, size: size)
    }

    // MARK: Loading

    /// `--pet <dir>`, then `TYPEPAL_PET_DIR`, then the pet bundled in
    /// `Contents/Resources/Pet` — which is what a generated app uses.
    private static func petDirectory() -> URL? {
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--pet"), i + 1 < args.count {
            return URL(fileURLWithPath: args[i + 1])
        }
        if let env = ProcessInfo.processInfo.environment["TYPEPAL_PET_DIR"], !env.isEmpty {
            return URL(fileURLWithPath: env)
        }
        if let bundled = Bundle.main.resourceURL?.appendingPathComponent("Pet"),
           FileManager.default.fileExists(atPath: bundled.appendingPathComponent("manifest.json").path) {
            return bundled
        }
        return nil
    }

    private func fail(_ message: String) {
        FileHandle.standardError.write(Data("[TypePal] \(message)\n".utf8))
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = Strings.cannotStart
        alert.informativeText = message
        alert.runModal()
        NSApp.terminate(nil)
    }
}
