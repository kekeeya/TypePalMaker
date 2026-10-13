import XCTest
@testable import TypePalCore

/// Weeks of use, compressed: a synthetic clock drives the pure logic through
/// every kind of event, checking nothing it holds grows with running time and
/// that it always comes back to rest. No windows, no real time.
final class LongRunTests: XCTestCase {
    private func spec(loop: Bool) -> StateSpec {
        StateSpec(enabled: true, fps: 8, loop: loop, frames: [FrameEntry(id: "x"), FrameEntry(id: "y")])
    }

    func testThirtyDaysOfEventsStayBoundedAndSettle() {
        var behavior = PetBehavior { _ in self.spec(loop: false) }
        var stroke = StrokeRecognizer()
        var rng = SystemRandomNumberGenerator()

        // Start deep into an uptime, where Double precision is thinnest.
        var t: TimeInterval = 100 * 86_400
        let end = t + 30 * 86_400
        var x = 0.0
        var maxPasses = 0
        var events = 0

        while t < end {
            // Mostly bursts of activity, sometimes long idle gaps (nights).
            t += Int.random(in: 0..<1000, using: &rng) == 0
                ? Double.random(in: 600...36_000, using: &rng)
                : Double.random(in: 0.01...2, using: &rng)
            switch Int.random(in: 0..<10, using: &rng) {
            case 0..<4: behavior.keyPressed(at: t)
            case 4..<6: behavior.mouseClicked(at: t)
            case 6: behavior.tapped(at: t)
            default:
                x += Double.random(in: -20...20, using: &rng)
                stroke.track(x: x, onPet: Bool.random(using: &rng), at: t)
                behavior.setStroking(stroke.isStroking, at: t)
            }
            // Rounds end as the animation would.
            if Bool.random(using: &rng) { behavior.roundFinished(at: t) }
            maxPasses = max(maxPasses, stroke.heldPassCount)
            events += 1
        }

        // Nothing held may grow with running time: the stroke window only
        // ever keeps the last 0.9s of passes.
        XCTAssertLessThan(maxPasses, 200, "stroke passes grew to \(maxPasses)")
        XCTAssertGreaterThan(events, 100_000)

        // Then everyone walks away: once the hand has stopped and the rounds
        // already started have played out, the pet must come back to rest.
        stroke.settle(at: t + 60)
        behavior.setStroking(stroke.isStroking, at: t + 60)
        for i in 1...3 { behavior.roundFinished(at: t + 60 + Double(i)) }
        XCTAssertEqual(behavior.current, .idle)
        XCTAssertFalse(stroke.isStroking)
        XCTAssertEqual(stroke.heldPassCount, 0)
    }

    func testTypingStillDetectedAfterMonthsOfUptime() {
        var behavior = PetBehavior { _ in self.spec(loop: false) }
        let monthsIn: TimeInterval = 180 * 86_400
        behavior.keyPressed(at: monthsIn)
        XCTAssertEqual(behavior.current, .typing)
        // Two frames at 8 fps: the round's second half starts 0.125s in.
        behavior.keyPressed(at: monthsIn + 0.2)
        behavior.roundFinished(at: monthsIn + 0.25)
        XCTAssertEqual(behavior.current, .typing)
        behavior.roundFinished(at: monthsIn + 0.5)
        XCTAssertEqual(behavior.current, .idle)
    }
}
