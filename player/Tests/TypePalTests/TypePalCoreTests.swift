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
        XCTAssertEqual(idle.durations, [0.25, 0.5])
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

    func testOnlyIdleLoops() {
        for state in PetState.allCases {
            XCTAssertEqual(spec().played(as: state).loop, state == .idle)
        }
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
