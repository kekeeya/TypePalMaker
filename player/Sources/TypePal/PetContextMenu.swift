import AppKit

/// The tiny TypePal-styled menu shown only when the artwork itself is
/// right-clicked. Dock and status-item menus deliberately stay as `NSMenu`.
final class PetContextMenuController {
    private var panel: NSPanel?
    private var localMonitor: Any?
    private var globalMonitor: Any?

    func show(actions: PetContextActions, at point: NSPoint) {
        close()

        let size = NSSize(width: 224, height: 94)
        let panel = PetContextPanel(contentRect: NSRect(origin: .zero, size: size))
        let content = PetContextMenuView(
            hide: { [weak self] in
                self?.close()
                actions.hide()
            },
            settings: { [weak self] in
                self?.close()
                actions.settings()
            }
        )
        panel.contentView = content

        let visible = NSScreen.screens.first(where: { $0.frame.contains(point) })?.visibleFrame
            ?? NSScreen.main?.visibleFrame
            ?? NSRect(x: point.x, y: point.y, width: size.width, height: size.height)
        var origin = NSPoint(x: point.x + 7, y: point.y - size.height + 8)
        origin.x = min(max(origin.x, visible.minX + 6), visible.maxX - size.width - 6)
        origin.y = min(max(origin.y, visible.minY + 6), visible.maxY - size.height - 6)
        panel.setFrameOrigin(origin)
        panel.orderFrontRegardless()
        self.panel = panel

        localMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .keyDown]) { [weak self, weak panel] event in
            if event.type == .keyDown, event.keyCode == 53 {
                self?.close()
                return nil
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

private final class PetContextPanel: NSPanel, NotAClickTarget {
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

private final class PetContextMenuView: NSView {
    init(hide: @escaping () -> Void, settings: @escaping () -> Void) {
        super.init(frame: NSRect(x: 0, y: 0, width: 224, height: 94))
        wantsLayer = true

        let hideRow = PetContextMenuRow(
            title: Strings.hidePet,
            symbol: "rectangle.dashed",
            badge: PetMenuColors.blue,
            action: hide
        )
        let settingsRow = PetContextMenuRow(
            title: Strings.settingsEllipsis,
            symbol: "gearshape",
            badge: PetMenuColors.yellow,
            action: settings
        )
        let divider = NSView()
        divider.wantsLayer = true
        divider.layer?.backgroundColor = PetMenuColors.separator.cgColor
        for view in [hideRow, divider, settingsRow] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        NSLayoutConstraint.activate([
            hideRow.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 6),
            hideRow.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -6),
            hideRow.topAnchor.constraint(equalTo: topAnchor, constant: 6),
            hideRow.heightAnchor.constraint(equalToConstant: 40),
            divider.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            divider.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
            divider.topAnchor.constraint(equalTo: hideRow.bottomAnchor),
            divider.heightAnchor.constraint(equalToConstant: 1),
            settingsRow.leadingAnchor.constraint(equalTo: hideRow.leadingAnchor),
            settingsRow.trailingAnchor.constraint(equalTo: hideRow.trailingAnchor),
            settingsRow.topAnchor.constraint(equalTo: divider.bottomAnchor),
            settingsRow.heightAnchor.constraint(equalToConstant: 40)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var wantsUpdateLayer: Bool { true }
    override func updateLayer() {
        layer?.cornerRadius = 18
        layer?.backgroundColor = PetMenuColors.background.cgColor
        layer?.borderWidth = 1.5
        layer?.borderColor = PetMenuColors.border.cgColor
    }
}

private final class PetContextMenuRow: NSView {
    private let action: () -> Void
    private var tracking: NSTrackingArea?

    init(title: String, symbol: String, badge: NSColor, action: @escaping () -> Void) {
        self.action = action
        super.init(frame: .zero)
        wantsLayer = true
        layer?.cornerRadius = 12

        let badgeView = PetMenuBadge(symbol: symbol, color: badge)
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: 15, weight: .semibold)
        label.textColor = PetMenuColors.text
        for view in [badgeView, label] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        NSLayoutConstraint.activate([
            badgeView.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 8),
            badgeView.centerYAnchor.constraint(equalTo: centerYAnchor),
            label.leadingAnchor.constraint(equalTo: badgeView.trailingAnchor, constant: 10),
            label.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])
        setAccessibilityElement(true)
        setAccessibilityRole(.button)
        setAccessibilityLabel(title)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func mouseDown(with event: NSEvent) { action() }
    override func mouseEntered(with event: NSEvent) { layer?.backgroundColor = PetMenuColors.hover.cgColor }
    override func mouseExited(with event: NSEvent) { layer?.backgroundColor = NSColor.clear.cgColor }

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
}

private final class PetMenuBadge: NSView {
    private let color: NSColor

    init(symbol: String, color: NSColor) {
        self.color = color
        super.init(frame: .zero)
        wantsLayer = true
        widthAnchor.constraint(equalToConstant: 28).isActive = true
        heightAnchor.constraint(equalToConstant: 28).isActive = true
        let image = NSImageView(image: NSImage(systemSymbolName: symbol, accessibilityDescription: nil) ?? NSImage())
        image.symbolConfiguration = .init(pointSize: 13, weight: .semibold)
        image.contentTintColor = PetMenuColors.icon
        image.translatesAutoresizingMaskIntoConstraints = false
        addSubview(image)
        NSLayoutConstraint.activate([
            image.centerXAnchor.constraint(equalTo: centerXAnchor),
            image.centerYAnchor.constraint(equalTo: centerYAnchor)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }
    override var wantsUpdateLayer: Bool { true }
    override func updateLayer() {
        layer?.cornerRadius = 12
        layer?.backgroundColor = color.cgColor
    }
}

private enum PetMenuColors {
    static let background = dynamic(light: 0xFFFEF9, dark: 0x292B34)
    static let border = dynamic(light: 0xCFC9F0, dark: 0x626078)
    static let separator = dynamic(light: 0xE8E2DD, dark: 0x454753)
    static let hover = dynamic(light: 0xF0EDFF, dark: 0x47435F)
    static let text = dynamic(light: 0x353754, dark: 0xF4F1FA)
    static let icon = dynamic(light: 0x353754, dark: 0x292A43)
    static let blue = dynamic(light: 0xC7E6F7, dark: 0x8EB5D4)
    static let yellow = dynamic(light: 0xFFE49B, dark: 0xD8B969)

    private static func dynamic(light: UInt32, dark: UInt32) -> NSColor {
        NSColor(name: nil) { appearance in
            let value = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light
            return NSColor(
                srgbRed: CGFloat((value >> 16) & 0xFF) / 255,
                green: CGFloat((value >> 8) & 0xFF) / 255,
                blue: CGFloat(value & 0xFF) / 255,
                alpha: 0.98
            )
        }
    }
}
