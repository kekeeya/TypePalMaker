import Foundation

/// The languages the interface can be shown in, chosen in Settings.
enum AppLanguage: String, CaseIterable, Identifiable {
    case chinese = "zh-Hans"
    case english = "en"

    var id: String { rawValue }

    /// Each language names itself, so the picker can be read whichever one is
    /// currently showing.
    var displayName: String {
        switch self {
        case .chinese: return "简体中文"
        case .english: return "English"
        }
    }

    /// Chinese if the system prefers it, English otherwise.
    static var systemDefault: AppLanguage {
        let preferred = Locale.preferredLanguages.first ?? "en"
        return preferred.hasPrefix("zh") ? .chinese : .english
    }

    static var current: AppLanguage {
        Preferences.language
    }
}

/// Every user-facing string, as a Chinese/English pair.
///
/// Computed rather than stored, so a language switch takes effect on the next
/// read: menus are rebuilt each time they open, and the settings form
/// re-renders when its model publishes the change.
enum Strings {
    private static func pick(_ zh: String, _ en: String) -> String {
        AppLanguage.current == .chinese ? zh : en
    }

    // MARK: Menus

    static var hidePet: String { pick("隐藏桌宠", "Hide Pet") }
    static var showPet: String { pick("显示桌宠", "Show Pet") }
    static var settingsEllipsis: String { pick("设置…", "Settings…") }
    static func quit(_ name: String) -> String { pick("退出 \(name)", "Quit \(name)") }
    static func about(_ name: String) -> String { pick("关于 \(name)", "About \(name)") }
    static func hideApp(_ name: String) -> String { pick("隐藏 \(name)", "Hide \(name)") }
    static var editMenu: String { pick("编辑", "Edit") }
    static var copy: String { pick("拷贝", "Copy") }
    static var selectAll: String { pick("全选", "Select All") }
    static var windowMenu: String { pick("窗口", "Window") }
    static var closeWindow: String { pick("关闭窗口", "Close Window") }
    static var close: String { pick("关闭", "Close") }

    // MARK: Settings

    static func settingsTitle(_ name: String) -> String { pick("\(name) 设置", "\(name) Settings") }
    static var sectionDisplay: String { pick("显示", "Display") }
    static var petSize: String { pick("桌宠大小", "Pet Size") }
    static var sizeSmall: String { pick("小", "S") }
    static var sizeLarge: String { pick("大", "L") }
    static var alwaysOnTop: String { pick("永远置顶", "Always on Top") }
    static var lockPosition: String { pick("锁定位置", "Lock Position") }
    static var clickThrough: String { pick("鼠标穿透", "Click-Through") }
    static var sectionGeneral: String { pick("通用", "General") }
    static var launchAtLogin: String { pick("开机时自动启动", "Launch at Login") }
    static func loginNeedsApproval(_ name: String) -> String {
        pick("还需要在系统设置的「登录项」里把 \(name) 打开。",
             "Turn on \(name) in System Settings › Login Items to finish.")
    }
    static var openLoginItems: String { pick("打开登录项设置", "Open Login Items Settings") }
    static var iconPlacement: String { pick("图标常驻", "Show Icon In") }
    static var dock: String { pick("程序坞", "Dock") }
    static var menuBar: String { pick("菜单栏", "Menu Bar") }
    static var language: String { pick("语言", "Language") }

    // MARK: Startup failures

    static var cannotStart: String { pick("TypePal 无法启动", "TypePal Can't Start") }
    static var petDataMissing: String {
        pick("找不到桌宠数据。\n\n开发时可用 --pet <目录> 或环境变量 TYPEPAL_PET_DIR 指定。",
             "Pet data not found.\n\nDuring development, pass --pet <dir> or set TYPEPAL_PET_DIR.")
    }
    static func petDataInvalid(_ detail: String) -> String {
        pick("桌宠数据有误：\(detail)", "The pet data is invalid: \(detail)")
    }
    static func framesUnreadable(_ ids: String) -> String {
        pick("以下帧的图片无法读取：\(ids)", "These frame images can't be read: \(ids)")
    }
}
