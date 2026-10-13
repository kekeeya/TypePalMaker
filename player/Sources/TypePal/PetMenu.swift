import AppKit

/// A menu item that runs a closure, so menus can be built inline without a
/// selector per entry.
final class ActionMenuItem: NSMenuItem {
    private let handler: () -> Void

    init(_ title: String, icon: NSImage? = nil, handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(fire), keyEquivalent: "")
        target = self
        image = icon
    }

    required init(coder: NSCoder) { fatalError("init(coder:) is not used") }

    @objc private func fire() { handler() }
}

/// The icons macOS puts on its own standard menu items, so ours match Finder's
/// "设置… / 隐藏 / 全部显示 / 退出" exactly.
///
/// Since macOS 26 the system assigns an icon to any item whose action is a
/// standard one — some of them private symbols (`Hide_app`, `Quit_app`) that
/// cannot be named directly. Borrowing the image from a throwaway item with
/// that action gets the real thing. Before macOS 26 system menus have no
/// icons, these come back nil, and ours stay plain too.
enum MenuIcon {
    static let settings = systemImage(for: "orderFrontPreferencesPanel:")
    static let hide = systemImage(for: "hide:")
    static let show = systemImage(for: "unhideAllApplications:")
    static let quit = systemImage(for: "terminate:")

    private static func systemImage(for action: String) -> NSImage? {
        NSMenuItem(title: "", action: Selector((action)), keyEquivalent: "").image
    }
}

/// The desktop pet uses these actions in its illustrated popover. Dock and
/// menu-bar entries still use `NSMenu` below and remain system rendered.
struct PetContextActions {
    let hide: () -> Void
    let settings: () -> Void
}

/// The menus, kept short on purpose: everything adjustable lives in the
/// settings window.
enum PetMenu {
    /// Right-click on the pet. It is on screen, so the only way to go is hidden.
    static func contextActions(pet: PetController, openSettings: @escaping () -> Void) -> PetContextActions {
        PetContextActions(
            hide: { pet.setVisible(false) },
            settings: openSettings
        )
    }

    /// The Dock icon's menu, when the app has one. Quitting is already offered
    /// by the Dock itself.
    ///
    /// No icons: the Dock draws this menu in its own process and takes only
    /// titles and states from it, so images would be dropped anyway.
    static func dock(pet: PetController, openSettings: @escaping () -> Void) -> NSMenu {
        let menu = NSMenu()
        menu.addItem(ActionMenuItem(pet.isVisible ? Strings.hidePet : Strings.showPet) { pet.setVisible(!pet.isVisible) })
        menu.addItem(ActionMenuItem(Strings.settingsEllipsis, handler: openSettings))
        return menu
    }

    /// The menu bar icon, in menu-bar mode: the way back once the pet is hidden
    /// or ignores the mouse, and the only place to quit from.
    static func statusBar(pet: PetController, openSettings: @escaping () -> Void) -> [NSMenuItem] {
        [
            ActionMenuItem(
            pet.isVisible ? Strings.hidePet : Strings.showPet,
            icon: pet.isVisible ? MenuIcon.hide : MenuIcon.show
        ) { pet.setVisible(!pet.isVisible) },
            ActionMenuItem(Strings.settingsEllipsis, icon: MenuIcon.settings, handler: openSettings),
            .separator(),
            ActionMenuItem(Strings.quit(pet.manifest.name), icon: MenuIcon.quit) { NSApp.terminate(nil) }
        ]
    }
}
