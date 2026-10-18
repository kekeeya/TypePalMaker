import Foundation

/// What the pet says, and when: one bubble at a time, on screen for a while
/// that grows with the line; the next can come as soon as it has gone (a
/// typing pet is typed at to see it react). A line due while one is up is
/// not said at all; nothing queues up. A pool does not give the same line
/// twice running.
public struct PetSpeech {
    private var quietUntil: TimeInterval = -.infinity
    private var lastLine: String?
    /// A number in 0..<1, uniformly; replaced in tests.
    private let random: () -> Double

    public init(random: @escaping () -> Double = { Double.random(in: 0..<1) }) {
        self.random = random
    }

    /// Seconds a line stays up: longer for longer lines, 2.5 to 6.
    public static func duration(of line: String) -> TimeInterval {
        min(6, max(2.5, 1.6 + 0.16 * Double(line.count)))
    }

    /// The lines a round may say: an action its own; the usual animation of
    /// a triggered reaction its reaction's. Idle and sleep say something only
    /// in their random actions.
    public static func pool(_ state: PetState, spec: StateSpec, variant: StateVariant?) -> [String] {
        if let variant { return variant.lines ?? [] }
        return state.loops ? [] : (spec.lines ?? [])
    }

    /// A line to say now, or nil: nothing to say, or the last still up.
    public mutating func say(from pool: [String], at time: TimeInterval) -> String? {
        let lines = pool.filter { !$0.isEmpty }
        guard !lines.isEmpty, time >= quietUntil else { return nil }
        let choices = lines.count > 1 ? lines.filter { $0 != lastLine } : lines
        let line = choices[min(choices.count - 1, Int(random() * Double(choices.count)))]
        lastLine = line
        quietUntil = time + Self.duration(of: line)
        return line
    }
}
