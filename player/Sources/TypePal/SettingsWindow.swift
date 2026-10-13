import AppKit
import ServiceManagement

/// The settings window, in plain AppKit.
///
/// It was SwiftUI at first. Once opened, SwiftUI kept 7–10 MB of framework
/// caches for the rest of the session — measured, and not given back on close
/// — which is a lot for a pet meant to sit in the background for days. This
/// draws the same grouped form by hand, so the app never loads SwiftUI at all.
///
/// The form is rebuilt from current values every time it opens, and on a
/// language switch; it is small enough that rebuilding beats keeping each
/// control in sync.
final class SettingsWindowController: NSObject, NSWindowDelegate {
    private let pet: PetController
    private var window: NSWindow?
    /// Where the window was when last closed, so reopening puts it back.
    private var lastTopLeft: NSPoint?
    /// Read back after a failed login-item change; shown until the next try.
    private var loginFailure: String?
    private var policySheet: PrivacyPolicySheet?
    /// Targets for the controls' actions, kept alive with the form.
    private var targets: [ClosureTarget] = []

    /// Called after "图标常驻" is switched.
    var onIconModeChanged: (() -> Void)?
    /// Called after the language is switched.
    var onLanguageChanged: (() -> Void)?

    init(pet: PetController) {
        self.pet = pet
    }

    func show() {
        let window = self.window ?? makeWindow()
        self.window = window
        rebuild()

        NSApp.activate(ignoringOtherApps: true)
        // Above the pet, which floats: otherwise a pet parked mid-screen can
        // sit right on top of its own settings.
        window.level = .floating
        window.makeKeyAndOrderFront(nil)
        window.orderFrontRegardless()
    }

    // MARK: Window

    private func makeWindow() -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: SettingsLayout.width, height: 400),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: true
        )
        window.isReleasedWhenClosed = false
        window.backgroundColor = SettingsColors.background
        window.delegate = self
        return window
    }

    func windowWillClose(_ notification: Notification) {
        guard let window else { return }
        lastTopLeft = NSPoint(x: window.frame.minX, y: window.frame.maxY)
        // Torn down after the close has finished, not during it.
        DispatchQueue.main.async { [weak self] in
            guard let self, let closed = self.window, !closed.isVisible else { return }
            closed.contentView = nil
            closed.delegate = nil
            self.window = nil
            self.targets.removeAll()
            self.policySheet = nil
            MemoryTrim.soon()
        }
    }

    /// Lays the form out again from current values, keeping the window's top
    /// edge where it is so a taller or shorter form does not make it jump.
    private func rebuild() {
        guard let window else { return }
        targets.removeAll()
        window.title = Strings.settingsTitle(pet.manifest.name)

        let form = makeForm()
        window.contentView = form
        let size = form.fittingSize

        let topLeft: NSPoint
        if window.isVisible {
            topLeft = NSPoint(x: window.frame.minX, y: window.frame.maxY)
        } else if let lastTopLeft {
            topLeft = lastTopLeft
        } else {
            window.setContentSize(size)
            window.center()
            return
        }
        window.setContentSize(size)
        window.setFrameTopLeftPoint(topLeft)
    }

    /// For rebuilds triggered from a control's own action: replacing the form
    /// there would free that control, and the closure still running in it,
    /// mid-call. Done once the action has returned instead.
    private func rebuildSoon() {
        DispatchQueue.main.async { [weak self] in
            guard let self, self.window != nil else { return }
            self.rebuild()
        }
    }

    // MARK: Form

    private func makeForm() -> NSView {
        let display = FormSection(
            title: Strings.sectionDisplay,
            symbol: "sun.max",
            badge: SettingsColors.badgeYellow,
            rows: [
            row(Strings.petSize, symbol: "display", badge: SettingsColors.badgeBlue, trailing: sizeSlider()),
            row(Strings.alwaysOnTop, symbol: "pin", badge: SettingsColors.badgePink, trailing: toggle(Preferences.alwaysOnTop) { [weak self] on in
                self?.pet.setAlwaysOnTop(on)
            }),
            row(Strings.lockPosition, symbol: "lock", badge: SettingsColors.badgeMint, trailing: toggle(Preferences.lockPosition) { on in
                Preferences.lockPosition = on
            }),
            row(Strings.clickThrough, symbol: "cursorarrow.click", badge: SettingsColors.badgePeach, trailing: toggle(Preferences.clickThrough) { [weak self] on in
                self?.pet.setClickThrough(on)
            })
        ])

        let general = FormSection(
            title: Strings.sectionGeneral,
            symbol: "gearshape",
            badge: SettingsColors.badgeBlue,
            rows: [
            loginRow(),
            row(Strings.iconPlacement, symbol: "dock.rectangle", badge: SettingsColors.badgeLavender, trailing: iconPlacementControl()),
            row(Strings.language, symbol: "character.bubble", badge: SettingsColors.badgeMint, trailing: languagePopUp())
        ])

        let stack = NSStackView(views: [
            display, general,
            footer()
        ])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = SettingsLayout.cardSpacing
        stack.setCustomSpacing(SettingsLayout.boxToFooter, after: general)
        stack.edgeInsets = NSEdgeInsets(
            top: SettingsLayout.topInset, left: 0,
            bottom: SettingsLayout.bottomInset, right: 0
        )
        stack.translatesAutoresizingMaskIntoConstraints = false

        let container = NSView()
        container.addSubview(stack)
        NSLayoutConstraint.activate([
            container.widthAnchor.constraint(equalToConstant: SettingsLayout.width),
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            stack.topAnchor.constraint(equalTo: container.topAnchor),
            stack.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])
        return container
    }

    private func row(_ title: String, symbol: String, badge: NSColor, trailing: NSView) -> NSView {
        FormRow(label: title, symbol: symbol, badge: badge, trailing: trailing)
    }

    // MARK: Controls

    /// 0.5×–2× in 16 notches of 10%, one tick mark per notch; the original
    /// size (1×) has a larger dot.
    private func sizeSlider() -> NSView {
        let slider = NSSlider(
            value: Preferences.scale,
            minValue: Preferences.scaleRange.lowerBound,
            maxValue: Preferences.scaleRange.upperBound,
            target: nil, action: nil
        )
        slider.numberOfTickMarks = 16
        slider.allowsTickMarkValuesOnly = true
        slider.tickMarkPosition = .below
        slider.isContinuous = true
        bind(slider) { [weak self] in self?.pet.setScale(slider.doubleValue) }
        let marked = MarkedSlider(slider: slider, markedValue: 1)
        marked.translatesAutoresizingMaskIntoConstraints = false
        marked.widthAnchor.constraint(equalToConstant: SettingsLayout.sliderWidth).isActive = true

        let stack = NSStackView(views: [
            caption(Strings.sizeSmall), marked, caption(Strings.sizeLarge)
        ])
        stack.spacing = 6
        stack.alignment = .centerY
        return stack
    }

    private func caption(_ text: String) -> NSTextField {
        let label = NSTextField(labelWithString: text)
        label.font = .systemFont(ofSize: 11)
        label.textColor = .secondaryLabelColor
        return label
    }

    private func toggle(_ isOn: Bool, onChange: @escaping (Bool) -> Void) -> NSSwitch {
        let control = NSSwitch()
        // Mini is the size SwiftUI's form toggles were drawn at.
        control.controlSize = .mini
        control.state = isOn ? .on : .off
        bind(control) { onChange(control.state == .on) }
        return control
    }

    /// The login item reads the system's real state each time the form is
    /// built: it can be removed in System Settings, or left waiting for
    /// approval, without the app being told.
    private func loginRow() -> NSView {
        let status = LaunchAtLogin.status
        let control = toggle(status == .enabled) { [weak self] wanted in
            guard let self else { return }
            do {
                try LaunchAtLogin.set(wanted)
                loginFailure = nil
            } catch {
                loginFailure = error.localizedDescription
            }
            // Read back rather than assumed: asking is not getting, and
            // `.requiresApproval` is exactly that gap.
            rebuildSoon()
        }

        var notes: [NSView] = []
        if status == .requiresApproval {
            notes.append(warning(Strings.loginNeedsApproval(pet.manifest.name), symbol: "exclamationmark.triangle"))
            let open = NSButton(title: Strings.openLoginItems, target: nil, action: nil)
            open.controlSize = .small
            open.bezelStyle = .rounded
            bind(open) { LaunchAtLogin.openLoginItemsSettings() }
            notes.append(open)
        }
        if let loginFailure {
            notes.append(warning(loginFailure, symbol: "xmark.circle"))
        }
        return FormRow(
            label: Strings.launchAtLogin,
            symbol: "power",
            badge: SettingsColors.badgeYellow,
            trailing: control,
            notes: notes
        )
    }

    private func warning(_ text: String, symbol: String) -> NSView {
        let icon = NSImageView(image: NSImage(systemSymbolName: symbol, accessibilityDescription: nil) ?? NSImage())
        icon.contentTintColor = .systemOrange
        icon.symbolConfiguration = .init(pointSize: 11, weight: .regular)
        let label = NSTextField(wrappingLabelWithString: text)
        label.font = .systemFont(ofSize: 11)
        label.textColor = .systemOrange
        label.preferredMaxLayoutWidth = SettingsLayout.boxWidth - 2 * SettingsLayout.rowInset - 20
        let stack = NSStackView(views: [icon, label])
        stack.alignment = .firstBaseline
        stack.spacing = 4
        return stack
    }

    private func iconPlacementControl() -> NSView {
        let control = NSSegmentedControl(
            labels: [Strings.dock, Strings.menuBar],
            trackingMode: .selectOne,
            target: nil, action: nil
        )
        control.selectedSegment = Preferences.useMenuBarIcon ? 1 : 0
        bind(control) { [weak self] in
            let menuBar = control.selectedSegment == 1
            guard menuBar != Preferences.useMenuBarIcon else { return }
            Preferences.useMenuBarIcon = menuBar
            // The handler re-shows (and so rebuilds) this window; see
            // `rebuildSoon` for why that waits until the click is over.
            DispatchQueue.main.async { self?.onIconModeChanged?() }
        }
        return control
    }

    private func languagePopUp() -> NSView {
        LanguageSelector(selected: Preferences.language) { [weak self] chosen in
            guard chosen != Preferences.language else { return }
            Preferences.language = chosen
            self?.onLanguageChanged?()
            // Every label changes, so the form is simply laid out again.
            self?.rebuildSoon()
        }
    }

    // MARK: Footer

    /// "Powered by TypePalMaker | Privacy Policy", small, muted and underlined — the
    /// footer of the AO3-Helper generator page. English in both languages, as
    /// it is there.
    private func footer() -> NSView {
        let maker = LinkButton(title: "TypePalMaker")
        bind(maker) { NSWorkspace.shared.open(AppInfo.githubURL) }
        let policy = LinkButton(title: "Privacy Policy")
        bind(policy) { [weak self] in self?.showPrivacyPolicy() }

        let stack = NSStackView(views: [
            footerText("Powered by "), maker, footerText("\u{00A0}\u{00A0}|\u{00A0}\u{00A0}"), policy
        ])
        stack.spacing = 0
        stack.alignment = .firstBaseline
        return stack
    }

    private func footerText(_ text: String) -> NSTextField {
        let label = NSTextField(labelWithString: text)
        label.font = .systemFont(ofSize: 12)
        label.textColor = .secondaryLabelColor
        return label
    }

    private func showPrivacyPolicy() {
        guard let window, window.attachedSheet == nil else { return }
        let sheet = PrivacyPolicySheet()
        policySheet = sheet
        sheet.present(on: window) { [weak self] in
            self?.policySheet = nil
        }
    }

    // MARK: Actions

    private func bind(_ control: NSControl, _ action: @escaping () -> Void) {
        let target = ClosureTarget(action)
        control.target = target
        control.action = #selector(ClosureTarget.fire)
        targets.append(target)
    }
}

// MARK: - Building blocks

/// Measurements read off the SwiftUI grouped form this replaces, so the two
/// look the same.
enum SettingsLayout {
    static let width: CGFloat = 520
    static let boxWidth: CGFloat = 472
    static let rowInset: CGFloat = 16
    static let rowHeight: CGFloat = 52
    static let headerHeight: CGFloat = 60
    static let iconSide: CGFloat = 34
    static let sliderWidth: CGFloat = 210
    static let languageWidth: CGFloat = 136
    static let cornerRadius: CGFloat = 18
    static let topInset: CGFloat = 26
    static let cardSpacing: CGFloat = 18
    static let boxToFooter: CGFloat = 22
    static let bottomInset: CGFloat = 20
}

/// TypePal's warm paper palette, with a quieter charcoal counterpart. Every
/// colour is dynamic, so changing the system appearance updates in place.
enum SettingsColors {
    static let background = dynamic(light: 0xFFFCF6, dark: 0x23242B)
    static let box = dynamic(light: 0xFFFEFC, dark: 0x2D2F38)
    static let row = dynamic(light: 0xFFFEFC, dark: 0x32343E)
    static let separator = dynamic(light: 0xECE6DE, dark: 0x454753)
    static let border = dynamic(light: 0xE4DDD4, dark: 0x4B4D59)
    static let accent = dynamic(light: 0x756FD8, dark: 0x9289F0)
    static let iconInk = dynamic(light: 0x353754, dark: 0x292A43)
    static let badgeYellow = dynamic(light: 0xF9D77E, dark: 0xD8B969)
    static let badgeBlue = dynamic(light: 0xBCDDF3, dark: 0x8EB5D4)
    static let badgeMint = dynamic(light: 0xBCE3D7, dark: 0x89C4B2)
    static let badgePink = dynamic(light: 0xF8C7C7, dark: 0xD79B9F)
    static let badgePeach = dynamic(light: 0xFFD3BE, dark: 0xDCA58D)
    static let badgeLavender = dynamic(light: 0xD5D0FA, dark: 0xA7A0DC)

    private static func dynamic(light: UInt32, dark: UInt32) -> NSColor {
        NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            let value = isDark ? dark : light
            return NSColor(
                srgbRed: CGFloat((value >> 16) & 0xFF) / 255,
                green: CGFloat((value >> 8) & 0xFF) / 255,
                blue: CGFloat(value & 0xFF) / 255,
                alpha: 1
            )
        }
    }
}

/// A rounded card with its own illustrated heading and rows.
final class FormSection: NSView {
    init(title: String, symbol: String, badge: NSColor, rows: [NSView]) {
        super.init(frame: .zero)
        wantsLayer = true
        translatesAutoresizingMaskIntoConstraints = false
        widthAnchor.constraint(equalToConstant: SettingsLayout.boxWidth).isActive = true

        var items: [NSView] = [SettingsCardHeader(title: title, symbol: symbol, badge: badge), Separator()]
        for (index, row) in rows.enumerated() {
            if index > 0 { items.append(Separator()) }
            items.append(row)
        }
        let stack = NSStackView(views: items)
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 0
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
        for item in items {
            item.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var wantsUpdateLayer: Bool { true }

    /// Layer colours are not dynamic, so they are re-resolved here, which
    /// AppKit calls again whenever the appearance changes.
    override func updateLayer() {
        layer?.cornerRadius = SettingsLayout.cornerRadius
        layer?.backgroundColor = SettingsColors.box.cgColor
        layer?.borderWidth = 1
        layer?.borderColor = SettingsColors.border.cgColor
    }
}

private final class SettingsCardHeader: NSView {
    init(title: String, symbol: String, badge: NSColor) {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        heightAnchor.constraint(equalToConstant: SettingsLayout.headerHeight).isActive = true

        let icon = SettingsIconBadge(symbol: symbol, color: badge, side: 38)
        let label = NSTextField(labelWithString: title)
        label.font = .boldSystemFont(ofSize: 17)
        label.textColor = .labelColor
        for view in [icon, label] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: leadingAnchor, constant: SettingsLayout.rowInset),
            icon.centerYAnchor.constraint(equalTo: centerYAnchor),
            label.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 12),
            label.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }
}

private final class SettingsIconBadge: NSView {
    private let color: NSColor

    init(symbol: String, color: NSColor, side: CGFloat = SettingsLayout.iconSide) {
        self.color = color
        super.init(frame: .zero)
        wantsLayer = true
        translatesAutoresizingMaskIntoConstraints = false
        widthAnchor.constraint(equalToConstant: side).isActive = true
        heightAnchor.constraint(equalToConstant: side).isActive = true

        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil) ?? NSImage()
        let icon = NSImageView(image: image)
        icon.symbolConfiguration = .init(pointSize: side * 0.43, weight: .medium)
        icon.contentTintColor = SettingsColors.iconInk
        icon.translatesAutoresizingMaskIntoConstraints = false
        addSubview(icon)
        NSLayoutConstraint.activate([
            icon.centerXAnchor.constraint(equalTo: centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var wantsUpdateLayer: Bool { true }
    override func updateLayer() {
        layer?.cornerRadius = bounds.width * 0.45
        layer?.backgroundColor = color.cgColor
    }
}

/// The 1pt line between rows, inset to line up with the row content.
private final class Separator: NSView {
    init() {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        heightAnchor.constraint(equalToConstant: 1).isActive = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func draw(_ dirtyRect: NSRect) {
        SettingsColors.separator.setFill()
        bounds.insetBy(dx: SettingsLayout.rowInset, dy: 0).fill()
    }
}

/// Label on the left, control on the right, optional notes underneath.
private final class FormRow: NSView {
    init(label text: String, symbol: String, badge: NSColor, trailing: NSView, notes: [NSView] = []) {
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false

        let icon = SettingsIconBadge(symbol: symbol, color: badge)
        let label = NSTextField(labelWithString: text)
        label.font = .systemFont(ofSize: 14, weight: .medium)
        label.textColor = .labelColor
        label.setContentCompressionResistancePriority(.required, for: .horizontal)

        let line = NSView()
        line.translatesAutoresizingMaskIntoConstraints = false
        for view in [icon, label, trailing] {
            view.translatesAutoresizingMaskIntoConstraints = false
            line.addSubview(view)
        }
        NSLayoutConstraint.activate([
            line.heightAnchor.constraint(greaterThanOrEqualToConstant: SettingsLayout.rowHeight),
            icon.leadingAnchor.constraint(equalTo: line.leadingAnchor, constant: SettingsLayout.rowInset),
            icon.centerYAnchor.constraint(equalTo: line.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 12),
            label.centerYAnchor.constraint(equalTo: line.centerYAnchor),
            trailing.trailingAnchor.constraint(equalTo: line.trailingAnchor, constant: -SettingsLayout.rowInset),
            trailing.centerYAnchor.constraint(equalTo: line.centerYAnchor),
            trailing.leadingAnchor.constraint(greaterThanOrEqualTo: label.trailingAnchor, constant: 12),
            trailing.heightAnchor.constraint(lessThanOrEqualTo: line.heightAnchor)
        ])

        let column = NSStackView(views: [line] + notes)
        column.orientation = .vertical
        column.alignment = .leading
        column.spacing = 4
        column.edgeInsets = NSEdgeInsets(top: 0, left: 0, bottom: notes.isEmpty ? 0 : 10, right: 0)
        column.translatesAutoresizingMaskIntoConstraints = false
        addSubview(column)
        NSLayoutConstraint.activate([
            column.leadingAnchor.constraint(equalTo: leadingAnchor),
            column.trailingAnchor.constraint(equalTo: trailingAnchor),
            column.topAnchor.constraint(equalTo: topAnchor),
            column.bottomAnchor.constraint(equalTo: bottomAnchor),
            line.widthAnchor.constraint(equalTo: column.widthAnchor)
        ])
        for note in notes {
            note.translatesAutoresizingMaskIntoConstraints = false
            note.leadingAnchor.constraint(equalTo: column.leadingAnchor, constant: SettingsLayout.rowInset).isActive = true
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }
}

/// Small, muted, underlined text that acts as a link, with the pointing hand
/// over it. A cursor rect rather than push/pop, so nothing can be left behind
/// on the cursor stack.
final class LinkButton: NSButton {
    init(title: String) {
        super.init(frame: .zero)
        isBordered = false
        setButtonType(.momentaryChange)
        attributedTitle = NSAttributedString(string: title, attributes: [
            .font: NSFont.systemFont(ofSize: 12),
            .foregroundColor: NSColor.secondaryLabelColor,
            .underlineStyle: NSUnderlineStyle.single.rawValue
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// Just the text: a borderless button still pads its title, which spaced
    /// "Powered by TypePalMaker | Privacy Policy" out wider than plain text.
    override var intrinsicContentSize: NSSize {
        let size = attributedTitle.size()
        return NSSize(width: ceil(size.width), height: ceil(size.height))
    }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .pointingHand)
    }
}

/// Turns a closure into a target/action pair.
final class ClosureTarget: NSObject {
    private let action: () -> Void

    init(_ action: @escaping () -> Void) {
        self.action = action
    }

    @objc func fire() { action() }
}

enum AppInfo {
    static let githubURL = URL(string: "https://github.com/kekeeya/TypePalMaker")!
}

/// Whether the pet comes back on its own after a restart.
enum LaunchAtLogin {
    static var status: SMAppService.Status {
        SMAppService.mainApp.status
    }

    static func set(_ enabled: Bool) throws {
        if enabled {
            try SMAppService.mainApp.register()
        } else {
            try SMAppService.mainApp.unregister()
        }
    }

    static func openLoginItemsSettings() {
        guard let url = URL(string: "x-apple.systempreferences:com.apple.LoginItems-Settings.extension")
        else { return }
        NSWorkspace.shared.open(url)
    }
}
