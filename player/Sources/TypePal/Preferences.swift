import AppKit

/// Per-pet settings. Each generated pet has its own bundle identifier, so
/// `UserDefaults.standard` is already private to it and several pets can run
/// side by side without sharing anything.
enum Preferences {
    private static let defaults = UserDefaults.standard

    private enum Key {
        static let scale = "scale"
        static let alwaysOnTop = "alwaysOnTop"
        static let clickThrough = "clickThrough"
        static let lockPosition = "lockPosition"
        static let visible = "visible"
        static let position = "position"
        static let useMenuBarIcon = "useMenuBarIcon"
        static let language = "language"
    }

    static func registerDefaults() {
        defaults.register(defaults: [
            Key.scale: 1.0,
            Key.alwaysOnTop: true,
            Key.clickThrough: false,
            Key.lockPosition: false,
            Key.visible: true,
            Key.useMenuBarIcon: false
        ])
    }

    /// Multiplier on the pet's designed height (`display.height`).
    static let scaleRange: ClosedRange<Double> = 0.5...2

    static var scale: Double {
        get { min(max(defaults.double(forKey: Key.scale), scaleRange.lowerBound), scaleRange.upperBound) }
        set { defaults.set(newValue, forKey: Key.scale) }
    }

    static var alwaysOnTop: Bool {
        get { defaults.bool(forKey: Key.alwaysOnTop) }
        set { defaults.set(newValue, forKey: Key.alwaysOnTop) }
    }

    static var clickThrough: Bool {
        get { defaults.bool(forKey: Key.clickThrough) }
        set { defaults.set(newValue, forKey: Key.clickThrough) }
    }

    static var lockPosition: Bool {
        get { defaults.bool(forKey: Key.lockPosition) }
        set { defaults.set(newValue, forKey: Key.lockPosition) }
    }

    /// Off: a normal app with a Dock icon. On: menu bar icon only, no Dock
    /// icon.
    static var useMenuBarIcon: Bool {
        get { defaults.bool(forKey: Key.useMenuBarIcon) }
        set { defaults.set(newValue, forKey: Key.useMenuBarIcon) }
    }

    /// Unset until chosen, so it follows the system language by default.
    static var language: AppLanguage {
        get { defaults.string(forKey: Key.language).flatMap(AppLanguage.init) ?? .systemDefault }
        set { defaults.set(newValue.rawValue, forKey: Key.language) }
    }

    static var visible: Bool {
        get { defaults.bool(forKey: Key.visible) }
        set { defaults.set(newValue, forKey: Key.visible) }
    }

    /// Where the pet was left: which display, and where on it.
    struct Position: Codable {
        var displayID: UInt32
        /// Window origin relative to the display's frame origin.
        var x: Double
        var y: Double
    }

    static var position: Position? {
        get {
            guard let data = defaults.data(forKey: Key.position) else { return nil }
            return try? JSONDecoder().decode(Position.self, from: data)
        }
        set {
            defaults.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: Key.position)
        }
    }
}

extension NSScreen {
    var displayID: UInt32? {
        (deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
    }
}
