import Foundation

/// What the pet says: one bubble at a time, on screen for a while that grows
/// with the line. A new line takes the place of the one up at once, so a
/// click is answered right away. A pool does not give the same line twice
/// running.
public struct PetSpeech {
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

    /// A line to say now, or nil when there is nothing to say.
    public mutating func say(from pool: [String]) -> String? {
        let lines = pool.filter { !$0.isEmpty }
        guard !lines.isEmpty else { return nil }
        let choices = lines.count > 1 ? lines.filter { $0 != lastLine } : lines
        let line = choices[min(choices.count - 1, Int(random() * Double(choices.count)))]
        lastLine = line
        return line
    }
}
