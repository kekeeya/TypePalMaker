import AppKit

/// Watches the keyboard and mouse without asking for any permission.
///
/// - Typing: polls how long ago the last key went down. That system-wide figure
///   is available to every app; seeing *which* key would need Input Monitoring,
///   and TypePal does not want to know.
/// - Mouse buttons and movement: global `NSEvent` monitors. Only keyboard
///   monitors are gated behind Accessibility.
///
/// Global monitors never see events aimed at TypePal's own windows, so a local
/// monitor covers those — the settings window, for one. Clicks on the pet are
/// left out of both: they are a tap or the context menu, not "a click".
final class InputMonitor {
    /// Reports the uptime at which the last key went down.
    var onKey: ((TimeInterval) -> Void)?
    var onMouseClick: ((TimeInterval) -> Void)?
    var onMouseMoved: (() -> Void)?
    /// The pet's own window, whose clicks are not reported.
    weak var petWindow: NSWindow?

    /// How often to look at the keyboard. The figure read is a timestamp, so
    /// polling only adds latency to noticing, never error to when.
    static let pollInterval: TimeInterval = 0.1

    private var pollTimer: Timer?
    private var clickMonitor: Any?
    private var localClickMonitor: Any?
    private var moveMonitor: Any?
    private var localMoveMonitor: Any?
    private var lastReportedKeyAt: TimeInterval = -.infinity

    func start() {
        guard pollTimer == nil else { return }

        let timer = Timer(timeInterval: Self.pollInterval, repeats: true) { [weak self] _ in
            self?.pollKeyboard()
        }
        timer.tolerance = Self.pollInterval * 0.2
        RunLoop.main.add(timer, forMode: .common)
        pollTimer = timer

        clickMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]
        ) { [weak self] _ in
            self?.onMouseClick?(ProcessInfo.processInfo.systemUptime)
        }
        localClickMonitor = NSEvent.addLocalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown, .otherMouseDown]
        ) { [weak self] event in
            if let self, event.window !== petWindow, !(event.window is NotAClickTarget) {
                onMouseClick?(ProcessInfo.processInfo.systemUptime)
            }
            return event
        }
        moveMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.mouseMoved, .leftMouseDragged, .rightMouseDragged]
        ) { [weak self] _ in
            self?.onMouseMoved?()
        }
        localMoveMonitor = NSEvent.addLocalMonitorForEvents(
            matching: [.mouseMoved, .leftMouseDragged, .rightMouseDragged]
        ) { [weak self] event in
            self?.onMouseMoved?()
            return event
        }
    }

    func stop() {
        pollTimer?.invalidate()
        pollTimer = nil
        for monitor in [clickMonitor, localClickMonitor, moveMonitor, localMoveMonitor].compactMap({ $0 }) {
            NSEvent.removeMonitor(monitor)
        }
        clickMonitor = nil
        localClickMonitor = nil
        moveMonitor = nil
        localMoveMonitor = nil
    }

    private func pollKeyboard() {
        let since = CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: .keyDown)
        let now = ProcessInfo.processInfo.systemUptime
        // Never in the future: the two clocks are not guaranteed to agree
        // across sleep, and a future key press would hold "typing" until the
        // clock caught up with it.
        let at = min(now - since, now)
        // Only news is reported; jitter in `since` is well under a millisecond.
        guard at > lastReportedKeyAt + 0.001 else { return }
        lastReportedKeyAt = at
        onKey?(at)
    }
}

/// TypePal's own little menus (the pet's right-click menu, the language
/// dropdown): choosing from them is not a click the pet should react to.
protocol NotAClickTarget {}
