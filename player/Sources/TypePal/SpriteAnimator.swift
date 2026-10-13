import AppKit
import TypePalCore

/// Plays one state's frames on a single `CALayer`.
///
/// Swapping `contents` is a GPU composite, not a redraw. There is at most one
/// timer, armed for exactly the current frame's duration; a single-frame
/// looping state arms none at all, which is what keeps an idle pet at ~0% CPU.
final class SpriteAnimator {
    let layer = CALayer()
    var onOneShotFinished: ((PetState) -> Void)?
    /// Called after each frame change, so hit testing can follow the artwork.
    var onFrameChanged: (() -> Void)?

    private let store: FrameStore
    private(set) var state: PetState?
    private var spec: StateSpec?
    private var index = 0
    /// One timer, re-armed per frame rather than recreated.
    private lazy var timer = ReusableTimer(tolerance: 0.008) { [weak self] in
        self?.advance()
    }
    private var isPaused = false

    private(set) var currentFrame: DecodedFrame?

    init(store: FrameStore) {
        self.store = store
        layer.contentsGravity = .resize
        layer.actions = ["contents": NSNull(), "bounds": NSNull(), "position": NSNull()]
    }

    /// Starts `state` from its first frame. The state already on screen
    /// carries on instead, unless `restart` asks for a new round of it.
    func play(_ state: PetState, spec: StateSpec, restart: Bool = false) {
        if state == self.state, !restart { return }
        self.state = state
        self.spec = spec
        index = 0
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

    private func show() {
        timer.cancel()
        guard let spec, index < spec.frames.count else { return }

        if let frame = store.frame(spec.frames[index].id) {
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layer.contents = frame.image
            layer.frame = frame.rect
            CATransaction.commit()
            currentFrame = frame
            onFrameChanged?()
        }

        guard !isPaused else { return }
        // A lone looping frame never changes: no timer at all.
        if spec.frames.count == 1, spec.loop { return }

        timer.schedule(after: max(spec.durations[index], 1.0 / 60))
    }

    private func advance() {
        guard let spec, let state else { return }
        if index >= spec.frames.count - 1 {
            if spec.loop {
                index = 0
                show()
            } else {
                // Hold the last frame until the state machine moves on.
                onOneShotFinished?(state)
            }
        } else {
            index += 1
            show()
        }
    }
}
