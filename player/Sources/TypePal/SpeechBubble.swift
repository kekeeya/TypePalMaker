import AppKit
import TypePalCore

/// The pet's speech bubble: one plain shape in the maker's colours (warm
/// white by default), no outline, no shadow, at most two lines, with a tail
/// pointing at the middle of the pet's head.
/// A child window of the pet, so it moves with it; it never takes the mouse.
/// Above the head, moved by the maker's offset, or below the pet when there
/// is no room above; always inside the screen. It comes in floating up a
/// little, quickly.
final class SpeechBubble {
    private weak var pet: NSWindow?
    private var window: NSPanel?
    private var anchor = CGPoint.zero
    private var offset = CGSize.zero
    private lazy var hideTimer = ReusableTimer(tolerance: 0.1) { [weak self] in self?.hide() }
    private var moveObserver: Any?

    init(pet: NSWindow) {
        self.pet = pet
    }

    /// Shows `line` for `duration` seconds, pointing at `anchor` (the top of
    /// the artwork, in the pet window's coordinates) from `offset` away (y
    /// up). A bubble already up takes the new line: a fast typist changes it
    /// often, and its window is reused rather than made again each time.
    func show(_ line: String, style: PetManifest.SpeechStyle, for duration: TimeInterval, pointingAt anchor: CGPoint, offset: CGSize = .zero) {
        guard let pet, pet.isVisible else { return }
        self.anchor = anchor
        self.offset = offset
        let view = BubbleView(line: line, style: style)
        if let window {
            window.contentView = view
            window.setContentSize(view.frame.size)
            place()
            view.rise()
            hideTimer.schedule(after: duration)
            return
        }
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
        view.rise()
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
        // Above the head, centred on it, then moved by the offset; below the
        // pet if the screen's top is in the way. The tail points at the head
        // wherever the bubble is.
        let spot = CGPoint(x: tip.x + offset.width, y: tip.y + offset.height)
        var origin = CGPoint(x: spot.x - size.width / 2, y: spot.y)
        // Moved down past the head, the bubble points up at it.
        var below = origin.y + size.height - BubbleView.margin < tip.y
        if !below, spot.y + size.height > screen.maxY {
            below = true
            origin.y = pet.frame.minY - size.height
            if origin.y < screen.minY { below = false; origin.y = screen.maxY - size.height }
        }
        origin.x = min(max(origin.x, screen.minX), screen.maxX - size.width)
        origin.y = min(max(origin.y, screen.minY), screen.maxY - size.height)
        view.tail = BubbleView.Tail(x: tip.x - origin.x, below: below)
        window.setFrameOrigin(origin)
    }
}

/// Draws the bubble; its size is the line's, two lines at most, at the
/// maker's text size and roominess.
final class BubbleView: NSView {
    struct Tail { var x: CGFloat; var below: Bool }
    var tail = Tail(x: 0, below: false) { didSet { needsDisplay = true } }

    private let text: NSAttributedString
    private let fill: NSColor
    private let padding: NSSize
    private let radius: CGFloat
    static let margin: CGFloat = 12    // clear space around it
    private static let tailHeight: CGFloat = 8
    /// How far the tail's tip may lean off its base, towards the head.
    private static let tailLean: CGFloat = 14

    /// At 13 pt and roominess 1, as designed: 14 × 9 padding, lines up to
    /// 200 wide, never narrower than 76 so the tail always leaves from the
    /// flat of the bottom edge, clear of the corners, however short the line.
    init(line: String, style: PetManifest.SpeechStyle) {
        let fontSize = CGFloat(style.fontSize)
        let room = CGFloat(style.bubbleSize)
        padding = NSSize(width: (14 * room).rounded(), height: (9 * room).rounded())
        radius = 14 * room
        fill = NSColor(hex: style.bubbleColor) ?? NSColor(srgbRed: 1, green: 0.992, blue: 0.969, alpha: 1)
        let maxTextWidth = (200 * fontSize / 13).rounded()
        let minBodyWidth = max(76, radius * 2 + 16 + 12)
        let font = NSFont.systemFont(ofSize: fontSize, weight: .semibold)
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byWordWrapping
        paragraph.alignment = .center
        text = NSAttributedString(string: line, attributes: [
            .font: font,
            .foregroundColor: NSColor(hex: style.textColor) ?? NSColor(srgbRed: 0.208, green: 0.216, blue: 0.329, alpha: 1),
            .paragraphStyle: paragraph,
        ])
        let lineHeight = ceil(font.ascender - font.descender + font.leading)
        let bounds = text.boundingRect(with: NSSize(width: maxTextWidth, height: lineHeight * 2), options: [.usesLineFragmentOrigin, .usesFontLeading])
        let textSize = NSSize(width: ceil(min(bounds.width, maxTextWidth)), height: min(ceil(bounds.height), lineHeight * 2))
        let size = NSSize(
            width: max(textSize.width + padding.width * 2, minBodyWidth) + Self.margin * 2,
            height: textSize.height + padding.height * 2 + Self.tailHeight + Self.margin * 2
        )
        super.init(frame: NSRect(origin: .zero, size: size))
        wantsLayer = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    /// Floats up into place from a little below, fading in: quick, so a
    /// click feels answered at once.
    func rise() {
        guard let layer else { return }
        let lift = CABasicAnimation(keyPath: "transform.translation.y")
        lift.fromValue = -6
        lift.toValue = 0
        let fade = CABasicAnimation(keyPath: "opacity")
        fade.fromValue = 0
        fade.toValue = 1
        let group = CAAnimationGroup()
        group.animations = [lift, fade]
        group.duration = 0.18
        // Cubic ease-out, as the Windows bubble and the Maker's preview.
        group.timingFunction = CAMediaTimingFunction(controlPoints: 0.33, 1, 0.68, 1)
        layer.add(group, forKey: "rise")
    }

    override func draw(_ dirtyRect: NSRect) {
        let m = Self.margin
        var body = bounds.insetBy(dx: m, dy: m)
        if tail.below { body.size.height -= Self.tailHeight } else { body.origin.y += Self.tailHeight; body.size.height -= Self.tailHeight }
        // The tail leaves the flat of the edge as near the head as it can and
        // leans towards it the rest of the way.
        let r = min(radius, body.height / 2, body.width / 2)
        let base = min(max(tail.x, body.minX + r + 8), body.maxX - r - 8)
        let tip = min(max(tail.x, base - Self.tailLean), base + Self.tailLean)
        let path = Self.outline(body: body, radius: r, tailBase: base, tailTip: tip, tailUp: tail.below)

        // One shape, bubble and tail, one fill: no outline, no shadow.
        fill.setFill()
        path.fill()

        let textRect = body.insetBy(dx: padding.width, dy: padding.height)
        text.draw(with: textRect, options: [.usesLineFragmentOrigin, .usesFontLeading, .truncatesLastVisibleLine])
    }

    /// The rounded body with the tail in its outline, under it (or over it,
    /// `tailUp`), 16 wide at its base centred on `tailBase`, its tip at
    /// `tailTip`.
    private static func outline(body: NSRect, radius r: CGFloat, tailBase tx: CGFloat, tailTip tip: CGFloat, tailUp: Bool) -> NSBezierPath {
        let (minX, maxX, minY, maxY) = (body.minX, body.maxX, body.minY, body.maxY)
        let p = NSBezierPath()
        p.move(to: CGPoint(x: minX + r, y: minY))
        if !tailUp {
            p.line(to: CGPoint(x: tx - 8, y: minY))
            p.line(to: CGPoint(x: tip, y: minY - tailHeight))
            p.line(to: CGPoint(x: tx + 8, y: minY))
        }
        p.line(to: CGPoint(x: maxX - r, y: minY))
        p.appendArc(from: CGPoint(x: maxX, y: minY), to: CGPoint(x: maxX, y: minY + r), radius: r)
        p.line(to: CGPoint(x: maxX, y: maxY - r))
        p.appendArc(from: CGPoint(x: maxX, y: maxY), to: CGPoint(x: maxX - r, y: maxY), radius: r)
        if tailUp {
            p.line(to: CGPoint(x: tx + 8, y: maxY))
            p.line(to: CGPoint(x: tip, y: maxY + tailHeight))
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

extension NSColor {
    /// `#RRGGBB`, in sRGB; nil for anything else.
    convenience init?(hex: String) {
        guard hex.count == 7, hex.first == "#", let value = UInt32(hex.dropFirst(), radix: 16) else { return nil }
        self.init(
            srgbRed: CGFloat((value >> 16) & 0xFF) / 255,
            green: CGFloat((value >> 8) & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255,
            alpha: 1
        )
    }
}
