import Foundation

/// What the pet says, and when: one bubble at a time, on screen for a while
/// that grows with the line, then at least `gap` of quiet before the next.
/// A line due in the quiet is not said at all; nothing queues up. A pool
/// does not give the same line twice running.
public struct PetSpeech {
    /// Quiet between two bubbles, from the end of one to the start of the next.
    public static let gap: TimeInterval = 10

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

    /// The lines a round may say. An action says its own; the usual
    /// animation says its reaction's on every round of a triggered reaction,
    /// and only on coming to a looping one (idle's rounds are a few seconds
    /// long, and would never stop talking).
    public static func pool(_ state: PetState, spec: StateSpec, variant: StateVariant?, entered: Bool) -> [String] {
        if let variant { return variant.lines ?? [] }
        return state.loops && !entered ? [] : (spec.lines ?? [])
    }

    /// A line to say now, or nil: nothing to say, or too soon after the last.
    public mutating func say(from pool: [String], at time: TimeInterval) -> String? {
        let lines = pool.filter { !$0.isEmpty }
        guard !lines.isEmpty, time >= quietUntil else { return nil }
        let choices = lines.count > 1 ? lines.filter { $0 != lastLine } : lines
        let line = choices[min(choices.count - 1, Int(random() * Double(choices.count)))]
        lastLine = line
        quietUntil = time + Self.duration(of: line) + Self.gap
        return line
    }
}
