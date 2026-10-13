import AppKit

/// Window level, Spaces behaviour and recovery for the pet panel.
///
/// The rule is "don't fight, recover at the moments that matter": no timer
/// keeps re-ordering the pet to the front — that would cost CPU and start a
/// tug-of-war with picture-in-picture, recording toolbars and other pets.
/// Instead it re-asserts itself after the user handles it, and after the
/// events that are known to knock floating windows out of place.
final class WindowLayering {
    private let window: NSWindow
    /// Whether the pet is supposed to be on screen right now.
    var wantsVisible: () -> Bool = { true }
    /// Invoked after recovery moved the window, so its position can be saved.
    var onRelocated: (() -> Void)?
    /// Invoked after every recovery, so the owner can re-check anything that
    /// normally waits for a notification which sleep or a display change may
    /// have swallowed.
    var onRecovered: (() -> Void)?

    private var observers: [(NotificationCenter, NSObjectProtocol)] = []

    init(window: NSWindow) {
        self.window = window
    }

    deinit {
        for (center, token) in observers {
            center.removeObserver(token)
        }
    }

    /// `.normal` rather than below the desktop when not on top: switching it
    /// off means "stop hovering over my work", not "hide behind the wallpaper".
    ///
    /// No `.fullScreenAuxiliary`: the pet stays out of full-screen Spaces, so a
    /// video or a presentation is never covered.
    func apply(alwaysOnTop: Bool) {
        window.level = alwaysOnTop ? .floating : .normal
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    }

    func startObserving() {
        let workspace = NSWorkspace.shared.notificationCenter
        for name in [
            NSWorkspace.activeSpaceDidChangeNotification,
            NSWorkspace.didWakeNotification,
            NSWorkspace.screensDidWakeNotification
        ] {
            observe(workspace, name)
        }
        observe(NotificationCenter.default, NSApplication.didChangeScreenParametersNotification)
    }

    /// Puts the pet back on top and back on a screen, if it should be shown.
    func reassert() {
        guard wantsVisible() else { return }
        if clampToScreens() {
            onRelocated?()
        }
        window.orderFrontRegardless()
        onRecovered?()
    }

    /// Keeps the window inside the visible part of some screen — the one it
    /// overlaps most, or the main screen if a display it was on is gone.
    /// Returns whether it had to move.
    @discardableResult
    func clampToScreens() -> Bool {
        let frame = window.frame
        let screen = NSScreen.screens.max { overlap($0.visibleFrame, frame) < overlap($1.visibleFrame, frame) }
        guard let screen = (screen.map { overlap($0.visibleFrame, frame) > 0 } == true ? screen : NSScreen.main)
        else { return false }

        let visible = screen.visibleFrame
        var origin = frame.origin
        origin.x = min(max(origin.x, visible.minX), visible.maxX - frame.width)
        origin.y = min(max(origin.y, visible.minY), visible.maxY - frame.height)
        guard origin != frame.origin else { return false }
        window.setFrameOrigin(origin)
        return true
    }

    private func overlap(_ a: CGRect, _ b: CGRect) -> CGFloat {
        let i = a.intersection(b)
        return i.isNull ? 0 : i.width * i.height
    }

    private func observe(_ center: NotificationCenter, _ name: Notification.Name) {
        let token = center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
            self?.reassert()
        }
        observers.append((center, token))
    }
}
