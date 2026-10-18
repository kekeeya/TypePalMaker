import AppKit
import TypePalCore

/// Plays a state on `CALayer`s: one per track, composited (see
/// `SpriteTimeline`). Swapping `contents` is a GPU composite, not a redraw.
/// There is at most one timer, armed for exactly the next frame change.
final class SpriteAnimator {
    let layer = CALayer()
    var onOneShotFinished: ((PetState) -> Void)?
    /// Called after each frame change, so hit testing can follow the artwork.
    var onFrameChanged: (() -> Void)?

    private let store: FrameStore
    private(set) var state: PetState?
    private var spec: StateSpec?
    private var elapsed: TimeInterval = 0
    private var scheduledBoundary: TimeInterval = 0
    private lazy var timer = ReusableTimer(tolerance: 0.008) { [weak self] in
        self?.advance()
    }
    private var isPaused = false
    private var trackLayers: [CALayer] = []

    private(set) var currentFrames: [DecodedFrame] = []

    init(store: FrameStore) {
        self.store = store
        layer.actions = ["bounds": NSNull(), "position": NSNull(), "sublayers": NSNull()]
    }

    /// Starts `state` from its first frame. The state already on screen
    /// carries on instead, unless `restart` asks for a new round of it.
    func play(_ state: PetState, spec: StateSpec, restart: Bool = false) {
        if state == self.state, !restart { return }
        self.state = state
        self.spec = spec
        elapsed = 0
        show()
    }

    /// Re-decodes the current frame, e.g. after a size change.
    func reload() {
        show()
    }

    func pause() {
        isPaused = true
        timer.cancel()
    }

    func resume() {
        guard isPaused else { return }
        isPaused = false
        show()
    }

    func isOpaque(at point: CGPoint) -> Bool {
        currentFrames.contains { $0.isOpaque(at: point) }
    }

    private func ensureLayers(_ count: Int) {
        while trackLayers.count < count {
            let child = CALayer()
            child.contentsGravity = .resize
            child.actions = ["contents": NSNull(), "bounds": NSNull(), "position": NSNull(), "hidden": NSNull()]
            layer.addSublayer(child)
            trackLayers.append(child)
        }
        for index in trackLayers.indices { trackLayers[index].isHidden = index >= count }
    }

    private func show() {
        timer.cancel()
        guard let spec else { return }
        let timeline = SpriteTimeline(spec: spec)
        ensureLayers(timeline.tracks.count)
        layer.frame = CGRect(origin: .zero, size: store.boxSize)
        let (entries, nextChange) = timeline.frames(at: elapsed)
        currentFrames.removeAll(keepingCapacity: true)

        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for (index, entry) in entries.enumerated() {
            let child = trackLayers[index]
            // The first row in the editor is the uppermost visual layer.
            child.zPosition = CGFloat(entries.count - index)
            guard let entry, let frame = store.frame(entry.id) else {
                child.contents = nil
                child.isHidden = true
                continue
            }
            child.isHidden = false
            child.contents = frame.image
            child.frame = frame.rect
            currentFrames.append(frame)
        }
        CATransaction.commit()
        onFrameChanged?()

        guard !isPaused, timeline.length > 0 else { return }
        // A lone looping frame never changes: no timer at all, which is what
        // keeps an idle pet at ~0% CPU.
        if timeline.isStill, spec.loop { return }
        scheduledBoundary = nextChange
        timer.schedule(after: max(scheduledBoundary - elapsed, 1.0 / 60))
    }

    private func advance() {
        guard let spec, let state else { return }
        elapsed = scheduledBoundary
        if elapsed >= spec.timelineDuration - 0.000_001 {
            if spec.loop {
                elapsed = 0
                show()
            } else {
                onOneShotFinished?(state)
            }
        } else {
            show()
        }
    }
}
