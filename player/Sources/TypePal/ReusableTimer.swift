import Foundation

/// A main-run-loop timer that is re-armed rather than recreated.
///
/// Some deadlines move on every event — a stroke settles 0.75s after the *last*
/// mouse move, an animation frame follows the one before. A one-shot `Timer`
/// is spent once it fires, so each of those would allocate a new one. This
/// keeps a single timer alive for the owner's lifetime: it repeats with an
/// interval so long it never repeats by itself, and is steered entirely
/// through `fireDate`. Disarmed, it sits at `distantFuture` and costs nothing.
final class ReusableTimer {
    private let timer: Timer

    init(tolerance: TimeInterval, action: @escaping () -> Void) {
        timer = Timer(fire: .distantFuture, interval: 1e9, repeats: true) { _ in
            action()
        }
        timer.tolerance = tolerance
        RunLoop.main.add(timer, forMode: .common)
    }

    deinit {
        timer.invalidate()
    }

    /// Fires once, `interval` from now, replacing any earlier schedule.
    func schedule(after interval: TimeInterval) {
        timer.fireDate = Date(timeIntervalSinceNow: max(interval, 0))
    }

    func cancel() {
        timer.fireDate = .distantFuture
    }
}
