import Foundation

/// Hand-tuned feel constants for stroking, tuned by hand on real hardware.
public enum StrokeTuning {
    /// Horizontal travel that counts as one pass of a hand.
    public static let strokeTravel: Double = 8
    /// More than this in a single sample is the pointer being warped.
    public static let maxSampleTravel: Double = 150
    /// Direction changes needed inside `strokeWindow` to start a stroke.
    public static let requiredReversals = 2
    public static let strokeWindow: TimeInterval = 0.9
    /// The sweep that carries the pointer onto the pet is travel, not a stroke.
    public static let entryGrace: TimeInterval = 0.2
    /// A rubbing hand goes back and forth without getting anywhere.
    public static let maxNetTravelShare: Double = 0.5
    /// Once stroking, it continues as long as a pass lands this often.
    public static let strokeLapse: TimeInterval = 0.7
}

/// Turns a stream of cursor positions into "a hand is stroking the pet".
///
/// There are no head/belly/tail zones: TypePal has a single petting reaction.
///
/// Hover-based on purpose: pressing and rubbing is the same input as dragging
/// the window, so requiring that no button is held keeps the two gestures from
/// competing for the same motion.
public struct StrokeRecognizer {
    public private(set) var isStroking = false

    private struct Pass {
        let direction: Int
        let length: Double
        let at: TimeInterval
    }

    private var lastX: Double?
    private var travel: Double = 0
    private var passes: [Pass] = []
    private var lastPassAt: TimeInterval?
    private var onPetSince: TimeInterval?

    public init() {}

    /// Passes still held in the sliding window. Exposed so tests can check it
    /// stays bounded however long the pet runs.
    public var heldPassCount: Int { passes.count }

    /// Feeds one cursor sample. `onPet` is false when the cursor is not on the
    /// pet's artwork.
    public mutating func track(x: Double, onPet: Bool, at time: TimeInterval) {
        guard onPet else {
            reset()
            return
        }
        defer { lastX = x }

        if onPetSince == nil {
            onPetSince = time
        }
        guard let lastX else { return }

        guard let onPetSince, time - onPetSince >= StrokeTuning.entryGrace else {
            travel = 0
            return
        }

        let delta = x - lastX
        guard abs(delta) <= StrokeTuning.maxSampleTravel else {
            travel = 0
            return
        }

        if travel == 0 || (delta < 0) == (travel < 0) {
            travel += delta
        } else {
            travel = delta
        }

        var committedPass = false
        if abs(travel) >= StrokeTuning.strokeTravel {
            passes.append(Pass(direction: travel < 0 ? -1 : 1, length: abs(travel), at: time))
            travel = 0
            lastPassAt = time
            committedPass = true
        }

        evaluate(at: time, committedPass: committedPass)
    }

    /// Re-evaluates without a new sample, so a hand that simply stops moving is
    /// noticed.
    public mutating func settle(at time: TimeInterval) {
        evaluate(at: time, committedPass: false)
    }

    public mutating func reset() {
        lastX = nil
        travel = 0
        passes.removeAll()
        lastPassAt = nil
        onPetSince = nil
        isStroking = false
    }

    private var reversalCount: Int {
        zip(passes, passes.dropFirst()).filter { $0.direction != $1.direction }.count
    }

    private var isWandering: Bool {
        let path = passes.reduce(0) { $0 + $1.length }
        let net = abs(passes.reduce(0) { $0 + Double($1.direction) * $1.length })
        return net <= path * StrokeTuning.maxNetTravelShare
    }

    private mutating func evaluate(at time: TimeInterval, committedPass: Bool) {
        passes.removeAll { time - $0.at > StrokeTuning.strokeWindow }

        if !isStroking {
            // Only movement may start a stroke, never the passing of time
            // (see the sliding window above).
            guard committedPass,
                  reversalCount >= StrokeTuning.requiredReversals,
                  isWandering
            else { return }
            isStroking = true
        } else {
            guard let lastPassAt, time - lastPassAt <= StrokeTuning.strokeLapse else {
                isStroking = false
                return
            }
        }
    }
}
