import AppKit
import TypePalCore

/// Owns one pet on screen: its window, animation, input and behaviour.
final class PetController {
    let manifest: PetManifest
    private let store: FrameStore
    private let animator: SpriteAnimator
    private let panel: PetPanel
    private let view: PetView
    private let layering: WindowLayering
    private let input = InputMonitor()

    private var behavior: PetBehavior
    /// The behaviour round the animator is showing.
    private var shownRound = -1
    private var stroke = StrokeRecognizer()
    private lazy var sleepTimer = ReusableTimer(tolerance: 0.05) { [weak self] in
        guard let self else { return }
        let now = ProcessInfo.processInfo.systemUptime
        behavior.checkInactivity(at: now)
        refresh()
    }
    /// A hand that stops moving produces no further events, so the stroke is
    /// re-checked just past the lapse to let it expire.
    private lazy var strokeSettleTimer = ReusableTimer(tolerance: 0.05) { [weak self] in
        guard let self else { return }
        stroke.settle(at: ProcessInfo.processInfo.systemUptime)
        publishStroke()
    }
    private var isOccluded = false
    /// Every half hour, and a minute after the pet stops being seen, what is
    /// not needed right now is let go (as the Windows pet does).
    private lazy var housekeepingTimer = ReusableTimer(tolerance: 60) { [weak self] in
        self?.housekeep()
    }
    private lazy var restTimer = ReusableTimer(tolerance: 5) { [weak self] in
        self?.releaseMemory()
    }
    private static let housekeepingInterval: TimeInterval = 30 * 60

    /// Builds the actions shown on right-click over the pet artwork.
    var menuProvider: (() -> PetContextActions)? {
        didSet { view.menuProvider = menuProvider }
    }

    init(manifest: PetManifest, directory: URL) {
        self.manifest = manifest
        store = FrameStore(manifest: manifest, directory: directory)
        animator = SpriteAnimator(store: store)
        behavior = PetBehavior(manifest: manifest)

        store.configure(scale: Preferences.scale, backingScale: NSScreen.main?.backingScaleFactor ?? 2)
        panel = PetPanel(size: store.boxSize)
        view = PetView(frame: NSRect(origin: .zero, size: store.boxSize))
        view.layer?.addSublayer(animator.layer)
        panel.contentView = view
        layering = WindowLayering(window: panel)
        input.petWindow = panel

        wire()
    }

    var unreadableFrameIDs: [String] { store.unreadableFrameIDs }

    var isVisible: Bool { panel.isVisible }

    // MARK: Lifecycle

    func start() {
        restorePosition()
        layering.apply(alwaysOnTop: Preferences.alwaysOnTop)
        layering.startObserving()
        behavior.activity(at: ProcessInfo.processInfo.systemUptime)
        refresh()
        setVisible(Preferences.visible)
        housekeepingTimer.schedule(after: Self.housekeepingInterval)
    }

    private func housekeep() {
        releaseMemory()
        housekeepingTimer.schedule(after: Self.housekeepingInterval)
    }

    /// Frames other than idle's are decoded again when next shown; the freed
    /// memory goes back to the system.
    private func releaseMemory() {
        store.releaseUnpinned()
        MemoryTrim.soon()
    }

    func setVisible(_ visible: Bool) {
        Preferences.visible = visible
        if visible {
            layering.clampToScreens()
            panel.orderFrontRegardless()
            updateActivity()
            updatePassthrough()
        } else {
            panel.orderOut(nil)
            panel.ignoresMouseEvents = true
            endStroke()
            updateActivity()
        }
    }

    // MARK: Settings

    func setScale(_ scale: Double) {
        guard abs(Preferences.scale - scale) > 0.0001 else { return }
        Preferences.scale = scale
        resize()
        MemoryTrim.soon()
    }

    func setAlwaysOnTop(_ on: Bool) {
        Preferences.alwaysOnTop = on
        layering.apply(alwaysOnTop: on)
    }

    func setClickThrough(_ on: Bool) {
        Preferences.clickThrough = on
        if on { endStroke() }
        updatePassthrough()
    }

    // MARK: Wiring

    private func wire() {
        animator.onOneShotFinished = { [weak self] _ in
            guard let self else { return }
            behavior.roundFinished(at: ProcessInfo.processInfo.systemUptime)
            refresh()
        }
        // The silhouette changes with the frame, so what is clickable does too.
        animator.onFrameChanged = { [weak self] in
            self?.updatePassthrough()
        }

        view.isOpaqueAt = { [weak self] point in
            self?.animator.isOpaque(at: point) ?? false
        }
        view.isDragLocked = { Preferences.lockPosition }
        view.onTap = { [weak self] in self?.handleTap() }
        view.onDragEnded = { [weak self] in
            guard let self else { return }
            layering.clampToScreens()
            savePosition()
            panel.orderFrontRegardless()
        }
        view.onMouseMoved = { [weak self] in self?.handleMouseMoved() }

        input.onKey = { [weak self] at in
            self?.behavior.keyPressed(at: at)
            self?.refresh()
        }
        input.onMouseClick = { [weak self] at in
            guard let self else { return }
            behavior.mouseClicked(at: at)
            refresh()
        }
        input.onMouseMoved = { [weak self] in self?.handleMouseMoved() }

        layering.wantsVisible = { Preferences.visible }
        layering.onRelocated = { [weak self] in self?.savePosition() }
        // Animation and polling pause while the pet cannot be seen and resume
        // on the occlusion notification. If a wake from sleep or a display
        // change ever fails to deliver it, the pet would stay frozen for good —
        // so the state is re-read at those moments rather than trusted.
        layering.onRecovered = { [weak self] in
            guard let self else { return }
            isOccluded = !panel.occlusionState.contains(.visible)
            updateActivity()
        }

        let center = NotificationCenter.default
        center.addObserver(
            forName: NSWindow.didChangeOcclusionStateNotification, object: panel, queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            isOccluded = !panel.occlusionState.contains(.visible)
            updateActivity()
        }
        center.addObserver(
            forName: NSWindow.didChangeBackingPropertiesNotification, object: panel, queue: .main
        ) { [weak self] _ in
            self?.resize()
        }
    }

    // MARK: Behaviour

    /// Shows what the behaviour has decided: a new round starts from its
    /// first frame; the round already playing carries on untouched.
    private func refresh() {
        let now = ProcessInfo.processInfo.systemUptime
        let state = behavior.current
        guard let spec = manifest.playable(state) else { return }
        let newRound = behavior.round != shownRound
        shownRound = behavior.round
        if state != animator.state { debugLog("state → \(state.rawValue)") }
        animator.play(state, spec: spec.played(as: state), restart: newRound && state != .idle)
        if let deadline = behavior.nextSleepDeadline(after: now) {
            sleepTimer.schedule(after: deadline - now + 0.01)
        } else {
            sleepTimer.cancel()
        }
    }

    private func handleTap() {
        behavior.tapped(at: ProcessInfo.processInfo.systemUptime)
        refresh()
        panel.orderFrontRegardless()
    }

    /// Every pointer move anywhere is activity. Cheap on purpose, as it runs
    /// for each move: the time is noted, and only a sleeping pet is woken. The
    /// sleep timer is not moved here; when it fires early it re-arms itself
    /// for the deadline the latest activity set.
    private func handleMouseMoved() {
        let wasAsleep = behavior.current == .sleep
        behavior.activity(at: ProcessInfo.processInfo.systemUptime)
        if wasAsleep { refresh() }
        trackStroke()
        updatePassthrough()
    }

    /// Animation and polling run only while the pet can actually be seen.
    private func updateActivity() {
        let active = panel.isVisible && !isOccluded
        if active {
            restTimer.cancel()
            input.start()
            animator.resume()
        } else {
            input.stop()
            animator.pause()
            restTimer.schedule(after: 60)
        }
        debugLog(active ? "active" : "paused")
    }

    // MARK: Pointer

    /// The cursor position in box coordinates if it lies on the pet's artwork.
    private func cursorOnPet() -> Bool {
        let screenPoint = NSEvent.mouseLocation
        guard panel.isVisible, panel.frame.contains(screenPoint) else { return false }
        let local = view.convert(panel.convertPoint(fromScreen: screenPoint), from: nil)
        return animator.isOpaque(at: local)
    }

    private func updatePassthrough() {
        guard panel.isVisible else { return }
        let wantsEvents = !Preferences.clickThrough && cursorOnPet()
        // Re-gating mid-press would cut a drag in half.
        guard NSEvent.pressedMouseButtons == 0 || !wantsEvents else { return }
        if panel.ignoresMouseEvents == wantsEvents {
            panel.ignoresMouseEvents = !wantsEvents
        }
    }

    private func trackStroke() {
        guard panel.isVisible, !Preferences.clickThrough, NSEvent.pressedMouseButtons == 0 else {
            endStroke()
            return
        }
        let screenPoint = NSEvent.mouseLocation
        guard panel.frame.contains(screenPoint) else {
            endStroke()
            return
        }
        stroke.track(
            x: screenPoint.x,
            onPet: cursorOnPet(),
            at: ProcessInfo.processInfo.systemUptime
        )
        publishStroke()
        strokeSettleTimer.schedule(after: StrokeTuning.strokeLapse + 0.05)
    }

    private func endStroke() {
        stroke.reset()
        publishStroke()
    }

    private func publishStroke() {
        let before = behavior.current
        behavior.setStroking(stroke.isStroking, at: ProcessInfo.processInfo.systemUptime)
        guard behavior.current != before else { return }
        refresh()
        if behavior.current == .pet { panel.orderFrontRegardless() }
    }

    // MARK: Size & position

    private func resize() {
        let oldFrame = panel.frame
        store.configure(
            scale: Preferences.scale,
            backingScale: panel.backingScaleFactor
        )
        let size = store.boxSize
        // Grow and shrink about the bottom centre, where the pet stands.
        let origin = NSPoint(x: oldFrame.midX - size.width / 2, y: oldFrame.minY)
        panel.setFrame(NSRect(origin: origin, size: size), display: false)
        view.frame = NSRect(origin: .zero, size: size)
        animator.reload()
        layering.clampToScreens()
        savePosition()
        debugLog("resized to \(Int(size.width))×\(Int(size.height))pt, cache \(store.cachedBytes / 1024)KB")
    }

    private func restorePosition() {
        let size = panel.frame.size
        if let saved = Preferences.position,
           let screen = NSScreen.screens.first(where: { $0.displayID == saved.displayID }) {
            panel.setFrameOrigin(NSPoint(
                x: screen.frame.minX + saved.x,
                y: screen.frame.minY + saved.y
            ))
        } else if let visible = NSScreen.main?.visibleFrame {
            panel.setFrameOrigin(NSPoint(x: visible.maxX - size.width - 48, y: visible.minY + 24))
        }
        layering.clampToScreens()
    }

    private func savePosition() {
        let frame = panel.frame
        guard let screen = panel.screen ?? NSScreen.main, let id = screen.displayID else { return }
        Preferences.position = .init(
            displayID: id,
            x: frame.minX - screen.frame.minX,
            y: frame.minY - screen.frame.minY
        )
    }
}

/// Read once: `ProcessInfo.environment` builds a fresh dictionary per call.
private let isDebugLogging = ProcessInfo.processInfo.environment["TYPEPAL_DEBUG"] == "1"

/// Set `TYPEPAL_DEBUG=1` to trace state changes on stderr.
func debugLog(_ message: @autoclosure () -> String) {
    guard isDebugLogging else { return }
    FileHandle.standardError.write(Data("[TypePal] \(message())\n".utf8))
}
