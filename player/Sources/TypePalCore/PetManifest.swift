import Foundation

/// The five reactions a pet can have. Raw values are the keys used in
/// `manifest.json`.
public enum PetState: String, CaseIterable, Codable, Sendable {
    case idle
    case typing
    case mouseClick
    case tap
    case pet
}

/// One frame in a state's sequence: which image, and for how long.
public struct FrameEntry: Equatable, Sendable {
    public let id: String
    /// Milliseconds. Nil means "1 / fps".
    public let duration: Double?

    public init(id: String, duration: Double? = nil) {
        self.id = id
        self.duration = duration
    }
}

extension FrameEntry: Decodable {
    private enum CodingKeys: String, CodingKey { case id, duration }

    /// Accepts both the short form `"a1b2"` and `{ "id": "a1b2", "duration": 500 }`.
    public init(from decoder: Decoder) throws {
        if let single = try? decoder.singleValueContainer(),
           let id = try? single.decode(String.self) {
            self.init(id: id)
            return
        }
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try container.decode(String.self, forKey: .id),
            duration: try container.decodeIfPresent(Double.self, forKey: .duration)
        )
    }
}

public struct StateSpec: Decodable, Equatable, Sendable {
    public let enabled: Bool
    public let fps: Double
    public let loop: Bool
    public let frames: [FrameEntry]

    public init(enabled: Bool, fps: Double, loop: Bool, frames: [FrameEntry]) {
        self.enabled = enabled
        self.fps = fps
        self.loop = loop
        self.frames = frames
    }

    /// Seconds each frame stays on screen.
    public var durations: [TimeInterval] {
        frames.map { ($0.duration.map { $0 / 1000 }) ?? (1 / fps) }
    }

    /// How a state is played, whatever its file says: idle loops, every
    /// reaction plays once per trigger (see `PetBehavior`).
    public func played(as state: PetState) -> StateSpec {
        StateSpec(enabled: enabled, fps: fps, loop: state == .idle, frames: frames)
    }
}

public struct PetManifest: Decodable, Sendable {
    public struct Display: Decodable, Sendable {
        public let height: Double
    }

    public struct FrameRef: Decodable, Sendable {
        public let file: String
    }

    public let schemaVersion: Int
    public let name: String
    public let id: String
    public let display: Display
    public let frames: [String: FrameRef]
    public let states: [PetState: StateSpec]

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, name, id, display, frames, states
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
        name = try container.decode(String.self, forKey: .name)
        id = try container.decode(String.self, forKey: .id)
        display = try container.decode(Display.self, forKey: .display)
        frames = try container.decode([String: FrameRef].self, forKey: .frames)

        // Decoded through String keys so that a key from a newer schema is
        // skipped rather than failing the whole pet.
        let raw = try container.decode([String: StateSpec].self, forKey: .states)
        var states: [PetState: StateSpec] = [:]
        for (key, spec) in raw {
            if let state = PetState(rawValue: key) {
                states[state] = spec
            }
        }
        self.states = states
    }

    public static func load(from directory: URL) throws -> PetManifest {
        let data = try Data(contentsOf: directory.appendingPathComponent("manifest.json"))
        let manifest = try JSONDecoder().decode(PetManifest.self, from: data)
        try manifest.validate()
        return manifest
    }

    /// The spec for a state if it may be shown, i.e. enabled and non-empty.
    public func playable(_ state: PetState) -> StateSpec? {
        guard let spec = states[state], spec.enabled, !spec.frames.isEmpty else { return nil }
        return spec
    }

    /// Every frame id referenced by a playable state.
    public var usedFrameIDs: Set<String> {
        Set(PetState.allCases.compactMap(playable).flatMap { $0.frames.map(\.id) })
    }

    public func validate() throws {
        guard schemaVersion == 1 else {
            throw ManifestError("不支持的 schemaVersion：\(schemaVersion)", "Unsupported schemaVersion: \(schemaVersion)")
        }
        guard playable(.idle) != nil else {
            throw ManifestError("默认状态（idle）必须开启且至少有一帧", "Idle must be on and have at least one frame")
        }
        guard display.height > 0 else {
            throw ManifestError("display.height 必须大于 0", "display.height must be greater than 0")
        }
        for (state, spec) in states where spec.enabled {
            guard !spec.frames.isEmpty else {
                throw ManifestError("状态 \(state.rawValue) 已开启但没有帧", "State \(state.rawValue) is on but has no frames")
            }
            guard spec.fps > 0 else {
                throw ManifestError("状态 \(state.rawValue) 的 fps 必须大于 0", "State \(state.rawValue) needs an fps greater than 0")
            }
            for entry in spec.frames where frames[entry.id] == nil {
                throw ManifestError("状态 \(state.rawValue) 引用了不存在的帧：\(entry.id)", "State \(state.rawValue) uses a missing frame: \(entry.id)")
            }
        }
    }
}

/// A problem with the pet's data, worded in both languages; the app shows
/// the one its interface uses (`prefersChinese`).
public struct ManifestError: Error, CustomStringConvertible {
    public let chinese: String
    public let english: String
    public init(_ chinese: String, _ english: String) {
        self.chinese = chinese
        self.english = english
    }

    /// Set by the app to follow its language setting.
    public static var prefersChinese: () -> Bool = { true }

    public var description: String { Self.prefersChinese() ? chinese : english }
}
