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
/// - **Random actions**: a triggered reaction plays one of its actions
///   instead of its usual animation by each action's chance, rolled when the
///   round starts. Idle and sleep play each of theirs once every so often (a
///   random time in the action's range), as one round, then loop as usual.
///   Idle's actions keep their times through other reactions; sleep's are
///   timed from falling asleep.
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
    /// The random action the round plays, if it is one.
    public private(set) var variant: String?

    private var roundStart: TimeInterval = 0
    private var roundLength: TimeInterval = 0
    private var isStroking = false
    private var lastKeyAt: TimeInterval = -.infinity
    private var lastStrokeAt: TimeInterval = -.infinity
    private var lastActivityAt: TimeInterval?
    /// When each of a looping reaction's actions is next due.
    private var due: [String: TimeInterval] = [:]
    /// A number in 0..<1, uniformly; replaced in tests.
    private let random: () -> Double

    public init(manifest: PetManifest) {
        self.init(playable: manifest.playable)
    }

    public init(playable: @escaping (PetState) -> StateSpec?, random: @escaping () -> Double = { Double.random(in: 0..<1) }) {
        self.playable = playable
        self.random = random
    }

    // MARK: Events

    public mutating func tapped(at time: TimeInterval) {
        activity(at: time)
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
        activity(at: time)
        lastKeyAt = max(lastKeyAt, time)
        if current == .idle { start(.typing, at: time) }
    }

    public mutating func mouseClicked(at time: TimeInterval) {
        activity(at: time)
        if current == .idle { start(.mouseClick, at: time) }
    }

    public mutating func activity(at time: TimeInterval) {
        // The pet starts out idle without entering it: its actions are timed
        // from the first sign of life.
        if lastActivityAt == nil, current == .idle { enter(.idle, at: time) }
        lastActivityAt = max(lastActivityAt ?? -.infinity, time)
        if current == .sleep {
            enter(.idle, at: time)
            round &+= 1
        }
    }

    // MARK: Random actions of idle and sleep

    /// When the soonest of the looping reaction's actions is due, if one
    /// can play now (the reaction is playing as usual).
    public func nextVariantDeadline(after time: TimeInterval) -> TimeInterval? {
        guard current.loops, variant == nil else { return nil }
        let times = (playable(current)?.variants ?? []).compactMap { due[$0.id] }
        return times.min().map { max(time, $0) }
    }

    /// Plays the looping reaction's action that is due, if one is, as one
    /// round.
    public mutating func checkVariants(at time: TimeInterval) {
        guard current.loops, variant == nil, let spec = playable(current) else { return }
        let ready = (spec.variants ?? [])
            .compactMap { v in due[v.id].map { (v, $0) } }
            .filter { $0.1 <= time }
            .min { $0.1 < $1.1 }
        guard let (action, _) = ready else { return }
        variant = action.id
        round &+= 1
        roundStart = time
        roundLength = spec.playing(action).timelineDuration
    }

    public mutating func checkInactivity(at time: TimeInterval) {
        guard current == .idle,
              let sleep = playable(.sleep),
              let lastActivityAt,
              time - lastActivityAt >= (sleep.sleepAfterMinutes ?? 15) * 60 else { return }
        start(.sleep, at: time)
    }

    public func nextSleepDeadline(after time: TimeInterval) -> TimeInterval? {
        guard current == .idle, let sleep = playable(.sleep), let lastActivityAt else { return nil }
        return max(time, lastActivityAt + (sleep.sleepAfterMinutes ?? 15) * 60)
    }

    /// The reaction showing has played its last frame through.
    public mutating func roundFinished(at time: TimeInterval) {
        if current.loops {
            // A looping reaction ends a round only when it was an action:
            // back to the usual loop, and the action is due again later.
            guard let action = variant, let spec = playable(current) else { return }
            variant = nil
            round &+= 1
            if let v = spec.variant(action) { schedule(v, after: time) }
            checkInactivity(at: time)
            return
        }
        let secondHalf = roundStart + roundLength / 2
        let ended = current
        enter(.idle, at: time)
        if isStroking, ended != .pet || lastStrokeAt >= secondHalf {
            start(.pet, at: time)
        }
        if current == .idle, lastKeyAt >= secondHalf {
            start(.typing, at: time)
        }
        checkInactivity(at: time)
    }

    // MARK: Private

    /// Begins a round of `state`, if the pet has it. A triggered reaction
    /// rolls for its random actions here.
    private mutating func start(_ state: PetState, at time: TimeInterval) {
        guard let spec = playable(state) else { return }
        if state.loops {
            enter(state, at: time)
            round &+= 1
            return
        }
        current = state
        variant = roll(spec.variants ?? [])
        round &+= 1
        roundStart = time
        roundLength = (spec.variant(variant).map(spec.playing) ?? spec).timelineDuration
    }

    /// Goes to a looping reaction, playing as usual. Sleep's actions are
    /// timed from now; idle's keep the times they had.
    private mutating func enter(_ state: PetState, at time: TimeInterval) {
        current = state
        variant = nil
        roundStart = time
        roundLength = playable(state)?.timelineDuration ?? 0
        for v in playable(state)?.variants ?? [] where state == .sleep || due[v.id] == nil {
            schedule(v, after: time)
        }
    }

    private mutating func schedule(_ v: StateVariant, after time: TimeInterval) {
        guard let range = v.every, range.count == 2, range[0] > 0, range[0] <= range[1] else {
            due[v.id] = nil
            return
        }
        due[v.id] = time + range[0] + random() * (range[1] - range[0])
    }

    /// One action by the chances, or none: a chance of 1 is always taken;
    /// chances adding up to more than 1 are shared out in proportion.
    private func roll(_ variants: [StateVariant]) -> String? {
        let chances = variants.map { max(0, $0.chance ?? 0) }
        let total = chances.reduce(0, +)
        guard total > 0 else { return nil }
        var draw = random() * max(1, total)
        for (v, chance) in zip(variants, chances) {
            if draw < chance { return v.id }
            draw -= chance
        }
        return nil
    }
}

extension PetState {
    /// Idle and sleep loop; every other reaction plays once per trigger.
    public var loops: Bool { self == .idle || self == .sleep }
}
