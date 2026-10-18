import XCTest
@testable import TypePalCore

final class ManifestTests: XCTestCase {
    private func decode(_ json: String) throws -> PetManifest {
        try JSONDecoder().decode(PetManifest.self, from: Data(json.utf8))
    }

    private let base = """
    {
      "schemaVersion": 1, "name": "Cat", "id": "cat", "display": { "height": 160 },
      "frames": { "a": { "file": "a.png" }, "b": { "file": "b.png" } },
      "states": {
        "idle": { "enabled": true, "fps": 4, "loop": true, "frames": ["a", { "id": "b", "duration": 500 }] },
        "typing": { "enabled": false, "fps": 8, "loop": true, "frames": [] },
        "someFutureState": { "enabled": true, "fps": 1, "loop": true, "frames": ["a"] }
      }
    }
    """

    func testDecodesBothFrameFormsAndDurations() throws {
        let manifest = try decode(base)
        let idle = try XCTUnwrap(manifest.playable(.idle))
        XCTAssertEqual(idle.frames, [FrameEntry(id: "a"), FrameEntry(id: "b", duration: 500)])
        XCTAssertEqual(idle.timelineDuration, 0.75)
        XCTAssertNoThrow(try manifest.validate())
    }

    func testDisabledStatesAreNotPlayableAndUnknownKeysAreIgnored() throws {
        let manifest = try decode(base)
        XCTAssertNil(manifest.playable(.typing))
        XCTAssertEqual(manifest.states.count, 2)
    }

    func testRejectsMissingIdleAndDanglingFrames() throws {
        let noIdle = base.replacingOccurrences(of: "\"idle\"", with: "\"tap\"")
        XCTAssertThrowsError(try decode(noIdle).validate())

        let dangling = base.replacingOccurrences(of: "\"frames\": [\"a\", {", with: "\"frames\": [\"zzz\", {")
        XCTAssertThrowsError(try decode(dangling).validate())
    }

    func testDecodesSleepTracks() throws {
        let json = """
        {
          "schemaVersion": 1, "name": "Cat", "id": "cat", "display": { "height": 160 },
          "frames": { "a": { "file": "a.png" }, "z": { "file": "z.png" } },
          "states": {
            "idle": { "enabled": true, "fps": 8, "loop": true, "frames": ["a"] },
            "sleep": {
              "enabled": true, "fps": 8, "loop": true, "frames": [{ "id": "a", "duration": 500 }],
              "sleepAfterMinutes": 15,
              "tracks": [
                { "id": "effects", "name": "Z", "frames": ["z"] },
                { "id": "base", "name": "Base", "frames": [{ "id": "a", "duration": 500 }] }
              ]
            }
          }
        }
        """
        let manifest = try decode(json)
        let sleep = try XCTUnwrap(manifest.playable(.sleep))
        XCTAssertEqual(sleep.timelineTracks.count, 2)
        XCTAssertEqual(sleep.timelineDuration, 0.5)
        XCTAssertEqual(sleep.sleepAfterMinutes, 15)
        XCTAssertEqual(manifest.usedFrameIDs, Set(["a", "z"]))
        XCTAssertNoThrow(try manifest.validate())
    }
}

final class BehaviorTests: XCTestCase {
    /// Four frames at 10 fps: every round lasts 0.4 s, its second half
    /// starting 0.2 s in.
    private func spec() -> StateSpec {
        StateSpec(enabled: true, fps: 10, loop: false, frames: (0..<4).map { FrameEntry(id: "f\($0)") })
    }

    private func behavior(disabled: Set<PetState> = []) -> PetBehavior {
        PetBehavior { state in disabled.contains(state) ? nil : self.spec() }
    }

    func testIdleByDefault() {
        let b = behavior()
        XCTAssertEqual(b.current, .idle)
    }

    func testAKeyPlaysTypingOnceThenIdle() {
        var b = behavior()
        b.keyPressed(at: 10)
        XCTAssertEqual(b.current, .typing)
        b.roundFinished(at: 10.4)
        XCTAssertEqual(b.current, .idle)
    }

    func testKeysInTheSecondHalfPlayAnotherRound() {
        var b = behavior()
        b.keyPressed(at: 10)
        let first = b.round
        b.keyPressed(at: 10.3)
        XCTAssertEqual(b.round, first, "a key mid-round does not restart it")
        b.roundFinished(at: 10.4)
        XCTAssertEqual(b.current, .typing)
        XCTAssertEqual(b.round, first + 1)
        b.roundFinished(at: 10.8)
        XCTAssertEqual(b.current, .idle)
    }

    func testKeysInTheFirstHalfAreAnsweredByThisRound() {
        var b = behavior()
        b.keyPressed(at: 10)
        b.keyPressed(at: 10.1)
        b.roundFinished(at: 10.4)
        XCTAssertEqual(b.current, .idle)
    }

    func testClicksDuringAClickAreIgnored() {
        var b = behavior()
        b.mouseClicked(at: 10)
        let round = b.round
        b.mouseClicked(at: 10.1)
        b.mouseClicked(at: 10.35)
        XCTAssertEqual(b.round, round)
        b.roundFinished(at: 10.4)
        XCTAssertEqual(b.current, .idle)
    }

    func testTypingAndClickingDoNotCutEachOtherOff() {
        var b = behavior()
        b.keyPressed(at: 10)
        b.mouseClicked(at: 10.1)
        XCTAssertEqual(b.current, .typing)
        b.roundFinished(at: 10.4)
        XCTAssertEqual(b.current, .idle)

        b.mouseClicked(at: 11)
        b.keyPressed(at: 11.3)
        XCTAssertEqual(b.current, .mouseClick)
        // The key came in the click's second half, so typing follows.
        b.roundFinished(at: 11.4)
        XCTAssertEqual(b.current, .typing)
    }

    func testTouchesCutInAndATapIsNotRestarted() {
        var b = behavior()
        b.keyPressed(at: 10)
        b.setStroking(true, at: 10.1)
        XCTAssertEqual(b.current, .pet)
        b.tapped(at: 10.2)
        XCTAssertEqual(b.current, .tap)
        let round = b.round
        b.tapped(at: 10.3)
        b.setStroking(true, at: 10.35)
        XCTAssertEqual(b.round, round, "neither a tap nor stroking restarts a tap")
        // Still being stroked when the tap ends: back to petting.
        b.roundFinished(at: 10.6)
        XCTAssertEqual(b.current, .pet)
    }

    func testPettingGoesOnWhileTheHandKeepsMoving() {
        var b = behavior()
        b.setStroking(true, at: 10)
        b.setStroking(true, at: 10.3)
        b.roundFinished(at: 10.4)
        XCTAssertEqual(b.current, .pet)
        b.setStroking(false, at: 10.5)
        b.roundFinished(at: 10.8)
        XCTAssertEqual(b.current, .idle)
    }

    func testDisabledStatesNeverStart() {
        var b = behavior(disabled: [.typing, .tap])
        b.keyPressed(at: 10)
        b.tapped(at: 10)
        XCTAssertEqual(b.current, .idle)
    }

    func testRestingStatesLoop() {
        for state in PetState.allCases {
            XCTAssertEqual(spec().played(as: state).loop, state == .idle || state == .sleep)
        }
    }

    func testSleepsAfterInactivityAndWakesOnActivity() {
        var b = PetBehavior { state in
            state == .sleep
                ? StateSpec(enabled: true, fps: 10, loop: true, frames: [FrameEntry(id: "sleep")], sleepAfterMinutes: 1.0 / 60.0)
                : self.spec()
        }
        b.activity(at: 0)
        b.checkInactivity(at: 0.9)
        XCTAssertEqual(b.current, .idle)
        b.checkInactivity(at: 1)
        XCTAssertEqual(b.current, .sleep)
        b.activity(at: 1.1)
        XCTAssertEqual(b.current, .idle)
    }
}

final class SpriteTimelineTests: XCTestCase {
    /// Sleep as the template has it, at 8 fps: a Z track of three 1-step
    /// frames over a base track of one 4-step frame.
    private func sleep() -> SpriteTimeline {
        SpriteTimeline(spec: StateSpec(
            enabled: true, fps: 8, loop: true, frames: [FrameEntry(id: "base", duration: 500)],
            tracks: [
                FrameTrack(id: "sleep-effects", name: "Z", frames: ["z1", "z2", "z3"].map { FrameEntry(id: $0) }),
                FrameTrack(id: "sleep-base", name: "Base", frames: [FrameEntry(id: "base", duration: 500)])
            ]
        ))
    }

    func testTracksPlayTogetherAndTheRoundIsTheLongest() {
        let t = sleep()
        XCTAssertEqual(t.length, 0.5, accuracy: 1e-9)
        XCTAssertFalse(t.isStill)

        var (entries, next) = t.frames(at: 0)
        XCTAssertEqual(entries.map { $0?.id }, ["z1", "base"])
        XCTAssertEqual(next, 0.125, accuracy: 1e-9)

        (entries, next) = t.frames(at: 0.25)
        XCTAssertEqual(entries.map { $0?.id }, ["z3", "base"])
        XCTAssertEqual(next, 0.375, accuracy: 1e-9)

        // The Z track has ended; the base holds until the round ends.
        (entries, next) = t.frames(at: 0.375)
        XCTAssertEqual(entries.map { $0?.id }, [nil, "base"])
        XCTAssertEqual(next, 0.5, accuracy: 1e-9)
    }

    func testAStateWithoutTracksIsOneTrack() {
        let t = SpriteTimeline(spec: StateSpec(enabled: true, fps: 4, loop: true, frames: [FrameEntry(id: "a")]))
        XCTAssertTrue(t.isStill)
        XCTAssertEqual(t.frames(at: 0).entries.map { $0?.id }, ["a"])
    }
}

final class SleepTimingTests: XCTestCase {
    private func behavior() -> PetBehavior {
        PetBehavior { state in
            StateSpec(enabled: true, fps: 10, loop: state == .idle, frames: [FrameEntry(id: "f")], sleepAfterMinutes: state == .sleep ? 1 : nil)
        }
    }

    func testActivityPushesTheDeadlineAndAnEarlyCheckDoesNothing() {
        var b = behavior()
        b.activity(at: 0)
        XCTAssertEqual(b.nextSleepDeadline(after: 0), 60)
        // The pointer moves at 30 s: the timer armed for 60 s fires early.
        b.activity(at: 30)
        b.checkInactivity(at: 60)
        XCTAssertEqual(b.current, .idle)
        XCTAssertEqual(b.nextSleepDeadline(after: 60), 90)
        b.checkInactivity(at: 90)
        XCTAssertEqual(b.current, .sleep)
        // Asleep, there is no deadline; a key wakes it into typing.
        XCTAssertNil(b.nextSleepDeadline(after: 91))
        b.keyPressed(at: 95)
        XCTAssertEqual(b.current, .typing)
    }

    func testNoSleepWithoutASleepState() {
        var b = PetBehavior { state in state == .sleep ? nil : StateSpec(enabled: true, fps: 10, loop: true, frames: [FrameEntry(id: "f")]) }
        b.activity(at: 0)
        b.checkInactivity(at: 100_000)
        XCTAssertEqual(b.current, .idle)
        XCTAssertNil(b.nextSleepDeadline(after: 0))
    }
}

final class StrokeTests: XCTestCase {
    /// Feeds a back-and-forth rub: `passes` sweeps of `width` points, sampled
    /// every 16ms.
    private func rub(_ r: inout StrokeRecognizer, from start: TimeInterval, passes: Int, width: Double = 30) -> TimeInterval {
        var t = start
        var x = 100.0
        for pass in 0..<passes {
            let dir: Double = pass.isMultiple(of: 2) ? 1 : -1
            for _ in 0..<6 {
                x += dir * width / 6
                t += 0.016
                r.track(x: x, onPet: true, at: t)
            }
        }
        return t
    }

    func testBackAndForthStartsAStroke() {
        var r = StrokeRecognizer()
        r.track(x: 100, onPet: true, at: 0)
        r.track(x: 100, onPet: true, at: 0.25)  // settle past entry grace
        _ = rub(&r, from: 0.25, passes: 4)
        XCTAssertTrue(r.isStroking)
    }

    func testCrossingOverIsNotAStroke() {
        var r = StrokeRecognizer()
        var t = 0.0
        for i in 0..<40 {
            t += 0.016
            r.track(x: Double(i) * 6, onPet: true, at: t)
        }
        XCTAssertFalse(r.isStroking)
    }

    func testStrokeLapsesWhenTheHandStops() {
        var r = StrokeRecognizer()
        r.track(x: 100, onPet: true, at: 0)
        r.track(x: 100, onPet: true, at: 0.25)
        let end = rub(&r, from: 0.25, passes: 4)
        XCTAssertTrue(r.isStroking)
        r.settle(at: end + StrokeTuning.strokeLapse + 0.1)
        XCTAssertFalse(r.isStroking)
    }

    func testLeavingThePetEndsTheStroke() {
        var r = StrokeRecognizer()
        r.track(x: 100, onPet: true, at: 0)
        r.track(x: 100, onPet: true, at: 0.25)
        let end = rub(&r, from: 0.25, passes: 4)
        r.track(x: 500, onPet: false, at: end + 0.016)
        XCTAssertFalse(r.isStroking)
    }
}

final class LayoutTests: XCTestCase {
    func testBoxFitsWidestFrameAndFramesStandOnTheBottom() {
        let box = SpriteLayout.boxSize(height: 100, imageSizes: [CGSize(width: 100, height: 100), CGSize(width: 200, height: 100)])
        XCTAssertEqual(box, CGSize(width: 200, height: 100))

        let square = SpriteLayout.fitRect(for: CGSize(width: 1254, height: 1254), in: box)
        XCTAssertEqual(square, CGRect(x: 50, y: 0, width: 100, height: 100))

        let wide = SpriteLayout.fitRect(for: CGSize(width: 400, height: 100), in: box)
        XCTAssertEqual(wide, CGRect(x: 0, y: 0, width: 200, height: 50))
    }
}

final class RandomActionTests: XCTestCase {
    private let frame = [FrameEntry(id: "f")]

    /// Idle with one action due every 60–120 s; typing with one at 25%.
    private func behavior(random: @escaping () -> Double) -> PetBehavior {
        let stretch = StateVariant(id: "stretch", tracks: [FrameTrack(id: "main", name: "", frames: frame + frame)], lines: ["好困…"], every: [60, 120])
        let fast = StateVariant(id: "fast", tracks: [], chance: 0.25)
        return PetBehavior(playable: { state in
            switch state {
            case .idle: StateSpec(enabled: true, fps: 10, loop: true, frames: self.frame, variants: [stretch])
            case .typing: StateSpec(enabled: true, fps: 10, loop: false, frames: self.frame, variants: [fast])
            default: nil
            }
        }, random: random)
    }

    func testIdlePlaysItsActionWhenDueThenLoopsAsUsual() {
        var b = behavior { 0.5 }
        b.activity(at: 0)
        // Typing in between keeps idle's time: 60 + 0.5 × 60 = 90 s.
        b.keyPressed(at: 1)
        b.roundFinished(at: 1.1)
        XCTAssertEqual(b.nextVariantDeadline(after: 2), 90)
        b.checkVariants(at: 50)
        XCTAssertNil(b.variant)
        let round = b.round
        b.checkVariants(at: 90)
        XCTAssertEqual(b.variant, "stretch")
        XCTAssertGreaterThan(b.round, round)
        XCTAssertNil(b.nextVariantDeadline(after: 91), "nothing else is due while it plays")
        b.roundFinished(at: 90.2)
        XCTAssertEqual(b.current, .idle)
        XCTAssertNil(b.variant)
        XCTAssertEqual(b.nextVariantDeadline(after: 91), 180.2)
    }

    func testAPetLeftIdleFromTheStartStillPlaysItsActions() {
        var b = behavior { 0.5 }
        b.activity(at: 0)
        XCTAssertEqual(b.nextVariantDeadline(after: 0), 90)
        b.activity(at: 30)
        XCTAssertEqual(b.nextVariantDeadline(after: 30), 90, "moving the mouse does not put it off")
    }

    func testAKeyCutsAnIdleActionShort() {
        var b = behavior { 0 }
        b.activity(at: 0)
        b.checkInactivity(at: 0)
        b.keyPressed(at: 0)
        b.roundFinished(at: 0.1)
        b.checkVariants(at: 60.1)
        XCTAssertEqual(b.variant, "stretch")
        b.keyPressed(at: 60.15)
        XCTAssertEqual(b.current, .typing)
    }

    func testTypingRollsForItsAction() {
        var low = behavior { 0.2 }
        low.keyPressed(at: 0)
        XCTAssertEqual(low.variant, "fast", "0.2 is under the 25% chance")
        var high = behavior { 0.3 }
        high.keyPressed(at: 0)
        XCTAssertNil(high.variant)
        XCTAssertEqual(high.current, .typing)
    }

    func testSpeechKeepsQuietAndDoesNotRepeat() {
        var speech = PetSpeech { 0 }
        XCTAssertEqual(speech.say(from: ["a", "b"], at: 0), "a")
        // "a" is up for 2.5 s, then 10 s of quiet.
        XCTAssertNil(speech.say(from: ["a", "b"], at: 12))
        XCTAssertEqual(speech.say(from: ["a", "b"], at: 12.5), "b")
        XCTAssertNil(speech.say(from: [], at: 100))
        XCTAssertEqual(PetSpeech.duration(of: String(repeating: "字", count: 30)), 6)
    }

    func testWhatARoundMaySay() {
        let spec = StateSpec(enabled: true, fps: 10, loop: true, frames: frame, lines: ["hi"])
        let action = StateVariant(id: "v", tracks: [], lines: ["yawn"])
        XCTAssertEqual(PetSpeech.pool(.idle, spec: spec, variant: nil, entered: true), ["hi"])
        XCTAssertEqual(PetSpeech.pool(.idle, spec: spec, variant: nil, entered: false), [])
        XCTAssertEqual(PetSpeech.pool(.typing, spec: spec, variant: nil, entered: false), ["hi"])
        XCTAssertEqual(PetSpeech.pool(.idle, spec: spec, variant: action, entered: false), ["yawn"])
    }

    func testAnActionWithoutPicturesPlaysTheUsualRows() {
        let spec = StateSpec(enabled: true, fps: 10, loop: true, frames: frame)
        XCTAssertEqual(spec.playing(StateVariant(id: "v", tracks: [FrameTrack(id: "main", name: "", frames: [])])).timelineTracks.first?.frames, frame)
    }
}
