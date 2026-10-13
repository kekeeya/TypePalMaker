import AppKit

/// TypePal's own language picker. The settings row already carries the
/// 文/EN badge, so this control deliberately contains only the chosen name
/// and a chevron.
final class LanguageSelector: NSView {
    private let selected: AppLanguage
    private let onSelect: (AppLanguage) -> Void
    private let dropdown = LanguageDropdownController()
    private let button = NSButton()

    init(selected: AppLanguage, onSelect: @escaping (AppLanguage) -> Void) {
        self.selected = selected
        self.onSelect = onSelect
        super.init(frame: .zero)
        wantsLayer = true
        translatesAutoresizingMaskIntoConstraints = false
        widthAnchor.constraint(equalToConstant: SettingsLayout.languageWidth).isActive = true
        heightAnchor.constraint(equalToConstant: 34).isActive = true

        let label = NSTextField(labelWithString: selected.displayName)
        label.font = .systemFont(ofSize: 13, weight: .medium)
        label.textColor = .labelColor
        label.translatesAutoresizingMaskIntoConstraints = false

        let chevron = NSImageView(image: NSImage(systemSymbolName: "chevron.down", accessibilityDescription: nil) ?? NSImage())
        chevron.symbolConfiguration = .init(pointSize: 10, weight: .semibold)
        chevron.contentTintColor = SettingsColors.accent
        chevron.translatesAutoresizingMaskIntoConstraints = false

        button.isBordered = false
        button.title = ""
        button.target = self
        button.action = #selector(toggleMenu)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.setAccessibilityLabel(Strings.language)
        button.setAccessibilityValue(selected.displayName)
        button.setAccessibilityHelp("\(Strings.language): \(selected.displayName)")

        addSubview(label)
        addSubview(chevron)
        addSubview(button)
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
            chevron.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -13),
            chevron.centerYAnchor.constraint(equalTo: centerYAnchor),
            chevron.leadingAnchor.constraint(greaterThanOrEqualTo: label.trailingAnchor, constant: 10),
            button.leadingAnchor.constraint(equalTo: leadingAnchor),
            button.trailingAnchor.constraint(equalTo: trailingAnchor),
            button.topAnchor.constraint(equalTo: topAnchor),
            button.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    @objc private func toggleMenu() {
        if dropdown.isVisible {
            dropdown.close()
        } else {
            dropdown.show(anchor: self, selected: selected) { [weak self] language in
                self?.onSelect(language)
            }
        }
    }

    override var wantsUpdateLayer: Bool { true }
    override func updateLayer() {
        layer?.cornerRadius = 11
        layer?.backgroundColor = LanguagePickerColors.control.cgColor
        layer?.borderWidth = 1.25
        layer?.borderColor = SettingsColors.accent.withAlphaComponent(0.78).cgColor
    }

    deinit { dropdown.close() }
}

private final class LanguageDropdownController {
    private var panel: NSPanel?
    private var localMonitor: Any?
    private var globalMonitor: Any?

    var isVisible: Bool { panel?.isVisible == true }

    func show(anchor: NSView, selected: AppLanguage, onSelect: @escaping (AppLanguage) -> Void) {
        close()
        guard let window = anchor.window else { return }

        let size = NSSize(width: 174, height: 94)
        let panel = LanguageDropdownPanel(contentRect: NSRect(origin: .zero, size: size))
        panel.appearance = window.effectiveAppearance
        panel.contentView = LanguageDropdownView(selected: selected) { [weak self] language in
            self?.close()
            onSelect(language)
        }

        let localRect = anchor.convert(anchor.bounds, to: nil)
        let screenRect = window.convertToScreen(localRect)
        var origin = NSPoint(x: screenRect.maxX - size.width, y: screenRect.maxY + 6)
        if let visible = window.screen?.visibleFrame {
            origin.x = min(max(origin.x, visible.minX + 6), visible.maxX - size.width - 6)
            origin.y = min(max(origin.y, visible.minY + 6), visible.maxY - size.height - 6)
        }
        panel.setFrameOrigin(origin)
        panel.orderFrontRegardless()
        self.panel = panel

        localMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .keyDown]) { [weak self, weak panel, weak anchor] event in
            if event.type == .keyDown, event.keyCode == 53 {
                self?.close()
                return nil
            }
            // A click on the picker itself is left to its own toggle, which
            // closes the list; closing here first would have it reopen.
            if let anchor, event.window === anchor.window,
               anchor.bounds.contains(anchor.convert(event.locationInWindow, from: nil)) {
                return event
            }
            if event.window !== panel { self?.close() }
            return event
        }
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            self?.close()
        }
    }

    func close() {
        panel?.orderOut(nil)
        panel = nil
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
        if let globalMonitor { NSEvent.removeMonitor(globalMonitor) }
        localMonitor = nil
        globalMonitor = nil
    }

    deinit { close() }
}

private final class LanguageDropdownPanel: NSPanel, NotAClickTarget {
    init(contentRect: NSRect) {
        super.init(
            contentRect: contentRect,
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        level = .popUpMenu
        hidesOnDeactivate = false
        animationBehavior = .none
        isReleasedWhenClosed = false
        becomesKeyOnlyIfNeeded = true
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

private final class LanguageDropdownView: NSView {
    init(selected: AppLanguage, onSelect: @escaping (AppLanguage) -> Void) {
        super.init(frame: NSRect(x: 0, y: 0, width: 174, height: 94))
        wantsLayer = true

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 2
        stack.translatesAutoresizingMaskIntoConstraints = false
        for language in AppLanguage.allCases {
            stack.addArrangedSubview(LanguageOptionRow(
                language: language,
                selected: language == selected,
                action: { onSelect(language) }
            ))
        }
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 7),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -7),
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 7),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -7)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var wantsUpdateLayer: Bool { true }
    override func updateLayer() {
        layer?.cornerRadius = 15
        layer?.backgroundColor = LanguagePickerColors.menu.cgColor
        layer?.borderWidth = 1.5
        layer?.borderColor = SettingsColors.accent.withAlphaComponent(0.86).cgColor
    }
}

private final class LanguageOptionRow: NSView {
    private let selected: Bool
    private let action: () -> Void
    private var tracking: NSTrackingArea?

    init(language: AppLanguage, selected: Bool, action: @escaping () -> Void) {
        self.selected = selected
        self.action = action
        super.init(frame: .zero)
        wantsLayer = true
        translatesAutoresizingMaskIntoConstraints = false
        heightAnchor.constraint(equalToConstant: 39).isActive = true

        let label = NSTextField(labelWithString: language.displayName)
        label.font = .systemFont(ofSize: 13, weight: selected ? .semibold : .medium)
        label.textColor = .labelColor
        label.translatesAutoresizingMaskIntoConstraints = false
        addSubview(label)

        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            label.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])

        if selected {
            let check = NSImageView(image: NSImage(systemSymbolName: "checkmark", accessibilityDescription: nil) ?? NSImage())
            check.symbolConfiguration = .init(pointSize: 11, weight: .bold)
            check.contentTintColor = SettingsColors.accent
            check.translatesAutoresizingMaskIntoConstraints = false
            addSubview(check)
            NSLayoutConstraint.activate([
                check.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
                check.centerYAnchor.constraint(equalTo: centerYAnchor)
            ])
        }

        setAccessibilityElement(true)
        setAccessibilityRole(.button)
        setAccessibilityLabel(language.displayName)
        setAccessibilityValue(selected ? "selected" : "")
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { action() }
    override func mouseEntered(with event: NSEvent) {
        guard !selected else { return }
        layer?.backgroundColor = LanguagePickerColors.hover.cgColor
    }
    override func mouseExited(with event: NSEvent) {
        layer?.backgroundColor = selected ? LanguagePickerColors.selected.cgColor : NSColor.clear.cgColor
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let next = NSTrackingArea(
            rect: .zero,
            options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(next)
        tracking = next
    }

    override var wantsUpdateLayer: Bool { true }
    override func updateLayer() {
        layer?.cornerRadius = 10
        layer?.backgroundColor = selected ? LanguagePickerColors.selected.cgColor : NSColor.clear.cgColor
    }
}

private enum LanguagePickerColors {
    static let control = dynamic(light: 0xFFFEFC, dark: 0x32343E)
    static let menu = dynamic(light: 0xFFFEFC, dark: 0x24252D)
    static let selected = dynamic(light: 0xF0EDFF, dark: 0x4B4569)
    static let hover = dynamic(light: 0xF7F5FF, dark: 0x3C394D)

    private static func dynamic(light: UInt32, dark: UInt32) -> NSColor {
        NSColor(name: nil) { appearance in
            let value = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light
            return NSColor(
                srgbRed: CGFloat((value >> 16) & 0xFF) / 255,
                green: CGFloat((value >> 8) & 0xFF) / 255,
                blue: CGFloat(value & 0xFF) / 255,
                alpha: 1
            )
        }
    }
}
