import AppKit

/// The pet's speech bubble: warm white, a light outline and a soft shadow,
/// at most two lines, with a tail pointing at the pet's head. A child window
/// of the pet, so it moves with it; it never takes the mouse. Above the pet,
/// or below it when there is no room above; always inside the screen.
final class SpeechBubble {
    private weak var pet: NSWindow?
    private var window: NSPanel?
    private var anchor = CGPoint.zero
    private lazy var hideTimer = ReusableTimer(tolerance: 0.1) { [weak self] in self?.hide() }
    private var moveObserver: Any?

    init(pet: NSWindow) {
        self.pet = pet
    }

    /// Shows `line` for `duration` seconds, pointing at `anchor` (the top of
    /// the artwork, in the pet window's coordinates).
    func show(_ line: String, for duration: TimeInterval, pointingAt anchor: CGPoint) {
        guard let pet, pet.isVisible else { return }
        hide()
        self.anchor = anchor
        let view = BubbleView(line: line)
        let panel = NSPanel(contentRect: NSRect(origin: .zero, size: view.frame.size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.animationBehavior = .none
        panel.collectionBehavior = pet.collectionBehavior
        panel.level = pet.level
        panel.contentView = view
        window = panel
        place()
        pet.addChildWindow(panel, ordered: .above)
        moveObserver = NotificationCenter.default.addObserver(forName: NSWindow.didMoveNotification, object: pet, queue: .main) { [weak self] _ in
            self?.place()
        }
        hideTimer.schedule(after: duration)
    }

    /// Takes the bubble away, window and all: nothing is kept while quiet.
    func hide() {
        hideTimer.cancel()
        if let moveObserver { NotificationCenter.default.removeObserver(moveObserver) }
        moveObserver = nil
        guard let window else { return }
        pet?.removeChildWindow(window)
        window.orderOut(nil)
        self.window = nil
    }

    private func place() {
        guard let pet, let window, let view = window.contentView as? BubbleView else { return }
        let screen = (pet.screen ?? NSScreen.main)?.visibleFrame ?? .infinite
        let size = window.frame.size
        let tip = CGPoint(x: pet.frame.minX + anchor.x, y: pet.frame.minY + anchor.y)
        // Above the head, the tail three quarters along; below the pet if the
        // screen's top is in the way.
        var below = tip.y + size.height > screen.maxY
        var origin = CGPoint(x: tip.x - size.width * 0.75, y: tip.y)
        if below {
            origin.y = pet.frame.minY - size.height
            if origin.y < screen.minY { below = false; origin.y = screen.maxY - size.height }
        }
        origin.x = min(max(origin.x, screen.minX), screen.maxX - size.width)
        view.tail = BubbleView.Tail(x: tip.x - origin.x, below: below)
        window.setFrameOrigin(origin)
    }
}

/// Draws the bubble; its size is the line's, two lines at most.
final class BubbleView: NSView {
    struct Tail { var x: CGFloat; var below: Bool }
    var tail = Tail(x: 0, below: false) { didSet { needsDisplay = true } }

    private let text: NSAttributedString
    private static let margin: CGFloat = 12    // room for the shadow
    private static let tailHeight: CGFloat = 8
    private static let padding = NSSize(width: 14, height: 9)
    private static let maxTextWidth: CGFloat = 200

    init(line: String) {
        let style = NSMutableParagraphStyle()
        style.lineBreakMode = .byWordWrapping
        text = NSAttributedString(string: line, attributes: [
            .font: NSFont.systemFont(ofSize: 13, weight: .semibold),
            .foregroundColor: NSColor(srgbRed: 0.208, green: 0.216, blue: 0.329, alpha: 1),
            .paragraphStyle: style,
        ])
        let font = NSFont.systemFont(ofSize: 13, weight: .semibold)
        let lineHeight = ceil(font.ascender - font.descender + font.leading)
        let bounds = text.boundingRect(with: NSSize(width: Self.maxTextWidth, height: lineHeight * 2), options: [.usesLineFragmentOrigin, .usesFontLeading])
        let textSize = NSSize(width: ceil(min(bounds.width, Self.maxTextWidth)), height: min(ceil(bounds.height), lineHeight * 2))
        let size = NSSize(
            width: textSize.width + Self.padding.width * 2 + Self.margin * 2,
            height: textSize.height + Self.padding.height * 2 + Self.tailHeight + Self.margin * 2
        )
        super.init(frame: NSRect(origin: .zero, size: size))
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    override func draw(_ dirtyRect: NSRect) {
        let m = Self.margin
        var body = bounds.insetBy(dx: m, dy: m)
        if tail.below { body.size.height -= Self.tailHeight } else { body.origin.y += Self.tailHeight; body.size.height -= Self.tailHeight }
        let path = Self.outline(body: body, radius: 14, tailX: min(max(tail.x, body.minX + 22), body.maxX - 22), tailUp: tail.below)

        // One shape, bubble and tail: one shadow and one outline.
        NSGraphicsContext.saveGraphicsState()
        let shadow = NSShadow()
        shadow.shadowColor = NSColor(white: 0.2, alpha: 0.16)
        shadow.shadowBlurRadius = 9
        shadow.shadowOffset = NSSize(width: 0, height: -3)
        shadow.set()
        NSColor(srgbRed: 1, green: 0.992, blue: 0.969, alpha: 1).setFill()
        path.fill()
        NSGraphicsContext.restoreGraphicsState()
        NSColor(srgbRed: 0.902, green: 0.875, blue: 0.839, alpha: 1).setStroke()
        path.lineWidth = 1
        path.lineJoinStyle = .round
        path.stroke()

        let textRect = body.insetBy(dx: Self.padding.width, dy: Self.padding.height)
        text.draw(with: textRect, options: [.usesLineFragmentOrigin, .usesFontLeading, .truncatesLastVisibleLine])
    }

    /// The rounded body with the tail in its outline, under it (or over it,
    /// `tailUp`), 16 wide at its base, its tip at `tailX`.
    private static func outline(body: NSRect, radius r: CGFloat, tailX tx: CGFloat, tailUp: Bool) -> NSBezierPath {
        let (minX, maxX, minY, maxY) = (body.minX, body.maxX, body.minY, body.maxY)
        let p = NSBezierPath()
        p.move(to: CGPoint(x: minX + r, y: minY))
        if !tailUp {
            p.line(to: CGPoint(x: tx - 8, y: minY))
            p.line(to: CGPoint(x: tx, y: minY - tailHeight))
            p.line(to: CGPoint(x: tx + 8, y: minY))
        }
        p.line(to: CGPoint(x: maxX - r, y: minY))
        p.appendArc(from: CGPoint(x: maxX, y: minY), to: CGPoint(x: maxX, y: minY + r), radius: r)
        p.line(to: CGPoint(x: maxX, y: maxY - r))
        p.appendArc(from: CGPoint(x: maxX, y: maxY), to: CGPoint(x: maxX - r, y: maxY), radius: r)
        if tailUp {
            p.line(to: CGPoint(x: tx + 8, y: maxY))
            p.line(to: CGPoint(x: tx, y: maxY + tailHeight))
            p.line(to: CGPoint(x: tx - 8, y: maxY))
        }
        p.line(to: CGPoint(x: minX + r, y: maxY))
        p.appendArc(from: CGPoint(x: minX, y: maxY), to: CGPoint(x: minX, y: maxY - r), radius: r)
        p.line(to: CGPoint(x: minX, y: minY + r))
        p.appendArc(from: CGPoint(x: minX, y: minY), to: CGPoint(x: minX + r, y: minY), radius: r)
        p.close()
        return p
    }
}
