import Foundation

/// Decides which reaction the pet shows, from what has happened.
///
/// Every reaction but idle plays its frames once per trigger — the frames the
/// user made, start to finish, never cut short by time running out:
///
/// - **tap** (clicking the pet) and **pet** (stroking it) are touches, and
///   cut in on anything else. A tap during a tap is ignored.
/// - **typing** and **mouseClick** only start from idle, so neither cuts the
///   other off; triggers while something else plays are ignored.
/// - When a round ends, a reaction still going on plays another — typing if
///   a key came in the round's second half, petting if the hand kept moving
///   in it. Keys in the first half are taken as answered by the round already
///   playing, so the pet stops at most about a round and a half after the
///   last key, never piling up rounds. Clicks during a round are simply
///   ignored.
/// - **idle** loops whenever nothing else is playing.
///
/// Pure logic: the AppKit side feeds it events and timestamps and reports
/// when a round has played through (`roundFinished`). States that are
/// disabled in the manifest are never started.
public struct PetBehavior {
    private let playable: (PetState) -> StateSpec?

    public private(set) var current: PetState = .idle
    /// Bumped whenever a reaction starts, so the caller can tell a new round
    /// of the same reaction from the one already playing.
    public private(set) var round = 0

    private var roundStart: TimeInterval = 0
    private var roundLength: TimeInterval = 0
    private var isStroking = false
    private var lastKeyAt: TimeInterval = -.infinity
    private var lastStrokeAt: TimeInterval = -.infinity

    public init(manifest: PetManifest) {
        self.init(playable: manifest.playable)
    }

    public init(playable: @escaping (PetState) -> StateSpec?) {
        self.playable = playable
    }

    // MARK: Events

    public mutating func tapped(at time: TimeInterval) {
        guard current != .tap else { return }
        start(.tap, at: time)
    }

    /// Fed on every pointer move: whether the pet is being stroked right now.
    public mutating func setStroking(_ stroking: Bool, at time: TimeInterval) {
        isStroking = stroking
        guard stroking else { return }
        lastStrokeAt = max(lastStrokeAt, time)
        if current != .tap, current != .pet { start(.pet, at: time) }
    }

    public mutating func keyPressed(at time: TimeInterval) {
        lastKeyAt = max(lastKeyAt, time)
        if current == .idle { start(.typing, at: time) }
    }

    public mutating func mouseClicked(at time: TimeInterval) {
        if current == .idle { start(.mouseClick, at: time) }
    }

    /// The reaction showing has played its last frame through.
    public mutating func roundFinished(at time: TimeInterval) {
        guard current != .idle else { return }
        let secondHalf = roundStart + roundLength / 2
        let ended = current
        current = .idle
        if isStroking, ended != .pet || lastStrokeAt >= secondHalf {
            start(.pet, at: time)
        }
        if current == .idle, lastKeyAt >= secondHalf {
            start(.typing, at: time)
        }
    }

    // MARK: Private

    /// Begins a round of `state`, if the pet has it.
    private mutating func start(_ state: PetState, at time: TimeInterval) {
        guard let spec = playable(state) else { return }
        current = state
        round &+= 1
        roundStart = time
        roundLength = spec.durations.reduce(0, +)
    }
}
