import AppKit

/// A panel that never takes keyboard focus.
///
/// `.nonactivatingPanel` is the point of the whole class: clicking, dragging or
/// stroking the pet leaves the app you were typing in frontmost, with its
/// caret where it was. A plain `NSWindow` would take focus on every click and
/// silently swallow the next few keystrokes.
final class PetPanel: NSPanel {
    init(size: NSSize) {
        super.init(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        // NSPanel hides itself whenever its app is not active — which for an
        // accessory app is nearly always.
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
        isReleasedWhenClosed = false
        acceptsMouseMovedEvents = true
        // Mostly empty space: failing towards passthrough is the safe default.
        ignoresMouseEvents = true
        animationBehavior = .none
        // ⌘H on the settings window hides the app; the pet is not part of that.
        canHide = false
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// The pet's content view: hosts the sprite layer and turns raw mouse input
/// into tap, drag and context-menu gestures.
final class PetView: NSView {
    /// Box-space point → is there artwork here.
    var isOpaqueAt: ((CGPoint) -> Bool)?
    var onTap: (() -> Void)?
    var onDragEnded: (() -> Void)?
    var onMouseMoved: (() -> Void)?
    var menuProvider: (() -> PetContextActions)?
    var isDragLocked: () -> Bool = { false }

    /// Movement below this between press and release is a click, not a drag.
    private let dragThreshold: CGFloat = 4

    private var pressScreenPoint: NSPoint?
    private var pressWindowOrigin: NSPoint?
    private var isDragging = false
    /// Moved far enough to be a drag, even if a locked position kept the
    /// window still — so letting go is not mistaken for a tap.
    private var didMovePastThreshold = false
    private var trackingArea: NSTrackingArea?
    private lazy var contextMenu = PetContextMenuController()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var isOpaque: Bool { false }

    /// A click on the pet should act straight away even though TypePal is not
    /// the active app — and must not activate it.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func hitTest(_ point: NSPoint) -> NSView? {
        let local = convert(point, from: superview)
        guard bounds.contains(local), isOpaqueAt?(local) == true else { return nil }
        return self
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let trackingArea { removeTrackingArea(trackingArea) }
        let area = NSTrackingArea(
            rect: .zero,
            options: [.mouseEnteredAndExited, .mouseMoved, .activeAlways, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(area)
        trackingArea = area
    }

    override func mouseMoved(with event: NSEvent) { onMouseMoved?() }
    override func mouseEntered(with event: NSEvent) { onMouseMoved?() }
    override func mouseExited(with event: NSEvent) { onMouseMoved?() }

    override func mouseDown(with event: NSEvent) {
        pressScreenPoint = NSEvent.mouseLocation
        pressWindowOrigin = window?.frame.origin
        isDragging = false
        didMovePastThreshold = false
    }

    override func mouseDragged(with event: NSEvent) {
        guard let window, let pressScreenPoint, let pressWindowOrigin else { return }
        let now = NSEvent.mouseLocation
        let dx = now.x - pressScreenPoint.x
        let dy = now.y - pressScreenPoint.y
        if !isDragging {
            guard hypot(dx, dy) >= dragThreshold else { return }
            didMovePastThreshold = true
            guard !isDragLocked() else { return }
            isDragging = true
        }
        window.setFrameOrigin(NSPoint(x: pressWindowOrigin.x + dx, y: pressWindowOrigin.y + dy))
    }

    override func mouseUp(with event: NSEvent) {
        defer {
            pressScreenPoint = nil
            pressWindowOrigin = nil
            isDragging = false
            didMovePastThreshold = false
        }
        if isDragging {
            onDragEnded?()
        } else if pressScreenPoint != nil, !didMovePastThreshold {
            onTap?()
        }
    }

    override func rightMouseDown(with event: NSEvent) {
        guard let actions = menuProvider?() else { return }
        contextMenu.show(actions: actions, at: NSEvent.mouseLocation)
    }
}
