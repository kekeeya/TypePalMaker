import Foundation

/// Where a state's timeline stands at a moment: which frame each track shows,
/// and when the next one changes.
///
/// A state is one or more tracks on a shared clock (sleep: a Z effect over
/// the pet). Each track plays its frames one after another; a track that ends
/// before the longest one shows nothing for the rest of the round, as the
/// Maker's timeline draws it. The round lasts as long as the longest track.
public struct SpriteTimeline {
    public let tracks: [FrameTrack]
    public let fps: Double
    /// Seconds in one round.
    public let length: TimeInterval

    public init(spec: StateSpec) {
        tracks = spec.timelineTracks
        fps = spec.fps
        length = spec.timelineDuration
    }

    public func duration(of entry: FrameEntry) -> TimeInterval {
        (entry.duration.map { $0 / 1000 }) ?? (1 / fps)
    }

    /// For each track, the frame showing at `time` (nil once the track has
    /// ended), and when the soonest of them ends.
    public func frames(at time: TimeInterval) -> (entries: [FrameEntry?], nextChange: TimeInterval) {
        var entries: [FrameEntry?] = []
        var next = length
        for track in tracks {
            var boundary: TimeInterval = 0
            var shown: FrameEntry?
            for entry in track.frames {
                boundary += duration(of: entry)
                if time < boundary - 0.000_001 {
                    shown = entry
                    next = min(next, boundary)
                    break
                }
            }
            entries.append(shown)
        }
        return (entries, next)
    }

    /// Nothing ever changes: one track holding one frame.
    public var isStill: Bool {
        tracks.count == 1 && tracks[0].frames.count == 1
    }
}
