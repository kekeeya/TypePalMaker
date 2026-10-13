import AppKit

/// The privacy policy, in the same shape as the AO3-Helper generator's:
/// a bilingual title, numbered sections, a closing note about updates.
///
/// Every claim here is a promise about the code. If a feature changes what is
/// read, stored or sent, this text changes with it.
enum PrivacyPolicy {
    /// Bilingual in Chinese, as on the AO3-Helper page; English only in English.
    static var title: String {
        AppLanguage.current == .chinese ? "Privacy Policy 隐私政策" : "Privacy Policy"
    }

    struct Section: Identifiable {
        let id = UUID()
        let heading: String?
        let body: String
    }

    static var sections: [Section] {
        AppLanguage.current == .chinese ? chinese : english
    }

    private static let chinese: [Section] = [
        Section(heading: nil, body: "使用本软件（以下称 TypePal）即表示你理解并同意本隐私政策。"),
        Section(
            heading: "一、我们收集的信息",
            body: "TypePal 不会收集、存储或上传你的任何信息。它完全在你的电脑本地运行，运行时不会发起任何网络请求。"
        ),
        Section(
            heading: "二、系统权限与输入感知",
            body: """
            TypePal 不申请任何系统权限（包括辅助功能、输入监控、屏幕录制等）。为了对你的操作做出反应，它只使用 macOS 向所有应用公开的以下信息：
            1. 打字反应：只读取系统提供的「距离上一次按键过去了多久」，用来判断你是否正在打字。它无法得知你按了哪个键、输入了什么内容，也不会记录。
            2. 鼠标点击反应：只在你按下鼠标按键时得知「发生了一次点击」，不读取、不记录点击的位置和所在的应用。
            3. 点击与抚摸：鼠标移动时读取光标当前的位置，只用来判断光标是否落在 TypePal 身上（以区分你是点到了它还是在抚摸它），不记录光标的移动轨迹。
            4. 以上信息只在内存中即时使用，用完即弃，不写入磁盘，也不会发送到任何地方。
            """
        ),
        Section(
            heading: "三、本地存储",
            body: """
            TypePal 把你的设置（桌宠大小、永远置顶、锁定位置、鼠标穿透、图标常驻、语言）以及它在屏幕上的位置，保存在本机的系统偏好设置中，仅用于下次启动时恢复。这些数据只存在于你自己的电脑上，不会上传；删除本软件后，可在「~/Library/Preferences」中删除对应的 .plist 文件彻底清除。
            「开机时自动启动」由 macOS 的「登录项」管理，你可以随时在系统设置中关闭。TypePal 的图片和配置打包在 App 内部，它不会读取你电脑上的其他文件。
            """
        ),
        Section(heading: nil, body: "本政策可能随功能更新而调整，如有重大变更会在项目主页说明。")
    ]

    private static let english: [Section] = [
        Section(heading: nil, body: "By using this app (\"TypePal\"), you understand and agree to this privacy policy."),
        Section(
            heading: "1. Information we collect",
            body: "TypePal does not collect, store or upload any of your information. It runs entirely on your computer and makes no network requests."
        ),
        Section(
            heading: "2. System permissions and input awareness",
            body: """
            TypePal asks for no system permissions (no Accessibility, Input Monitoring or Screen Recording). To react to what you do, it uses only the following information, which macOS makes available to every app:
            1. Typing: it reads only "how long since the last key press", provided by the system, to tell whether you are typing. It cannot see which keys you press or what you type, and records nothing.
            2. Mouse clicks: it learns only that "a click happened" when you press a mouse button. It does not read or record where you clicked or in which app.
            3. Clicking and petting: when the mouse moves, it reads where the pointer is, only to tell whether it is over TypePal (so it knows whether you clicked it or are petting it). It does not record where the pointer has been.
            4. All of the above is used in memory at that moment and then discarded. None of it is written to disk or sent anywhere.
            """
        ),
        Section(
            heading: "3. Local storage",
            body: """
            Your settings (pet size, always on top, lock position, click-through, icon placement, language) and TypePal's position on screen are kept in your Mac's system preferences, only so they can be restored next time. They stay on your computer and are never uploaded. After deleting the app, you can remove them completely by deleting its .plist file in "~/Library/Preferences".
            "Launch at Login" is managed by macOS Login Items and can be turned off in System Settings at any time. TypePal's images and configuration are packaged inside the app; it does not read any other files on your computer.
            """
        ),
        Section(heading: nil, body: "This policy may change as features are updated. Significant changes will be announced on the project page.")
    ]
}

extension PrivacyPolicy {
    /// The whole policy as one attributed string, so it can be selected and
    /// copied in one go. Sections are told apart by spacing, not blank lines;
    /// the closing note gets a blank line of its own above it.
    static func attributedText() -> NSAttributedString {
        let bodyFont = NSFont.systemFont(ofSize: 13)
        let headingFont = NSFont.boldSystemFont(ofSize: 13)
        let text = NSMutableAttributedString()
        let all = sections

        for (index, section) in all.enumerated() {
            let isLast = index == all.count - 1
            let part = NSMutableAttributedString()
            if isLast {
                part.append(NSAttributedString(string: "\n", attributes: [.font: bodyFont]))
            }
            if let heading = section.heading {
                part.append(NSAttributedString(string: heading + "\n", attributes: [.font: headingFont]))
            }
            part.append(NSAttributedString(string: section.body, attributes: [.font: bodyFont]))
            if !isLast {
                part.append(NSAttributedString(string: "\n", attributes: [.font: bodyFont]))
            }

            let lines = NSMutableParagraphStyle()
            lines.lineSpacing = 4
            lines.paragraphSpacing = 2
            part.addAttribute(.paragraphStyle, value: lines, range: NSRange(location: 0, length: part.length))

            // The gap that separates this section from the next sits on its
            // last paragraph only.
            let gap = lines.mutableCopy() as! NSMutableParagraphStyle
            gap.paragraphSpacing = 10
            let lastParagraph = (part.string as NSString).paragraphRange(
                for: NSRange(location: max(part.length - 1, 0), length: 0)
            )
            part.addAttribute(.paragraphStyle, value: gap, range: lastParagraph)

            text.append(part)
        }
        text.addAttribute(.foregroundColor, value: NSColor.labelColor, range: NSRange(location: 0, length: text.length))
        return text
    }
}

/// The policy as a sheet over the settings window: title, close button
/// top-right, scrolling body — the layout of the AO3-Helper modal.
///
/// The body is one read-only `NSTextView`, so it can be selected across
/// sections and copied with ⌘A / ⌘C or the context menu. Esc closes it, as
/// does the ×.
final class PrivacyPolicySheet {
    private static let size = NSSize(width: 420, height: 440)

    private var window: PolicySheetWindow?
    private var closeTarget: ClosureTarget?

    func present(on parent: NSWindow, onClose: @escaping () -> Void) {
        let window = PolicySheetWindow(
            contentRect: NSRect(origin: .zero, size: Self.size),
            styleMask: [.titled],
            backing: .buffered,
            defer: true
        )
        window.isReleasedWhenClosed = false
        window.backgroundColor = SettingsColors.background
        window.contentView = makeContent(closing: window)
        self.window = window

        parent.beginSheet(window) { [weak self] _ in
            self?.window = nil
            self?.closeTarget = nil
            onClose()
        }
    }

    private func makeContent(closing window: PolicySheetWindow) -> NSView {
        let content = NSView(frame: NSRect(origin: .zero, size: Self.size))

        let title = NSTextField(labelWithString: PrivacyPolicy.title)
        title.font = .boldSystemFont(ofSize: 16)
        title.textColor = .labelColor

        let close = NSButton(
            image: NSImage(systemSymbolName: "xmark", accessibilityDescription: Strings.close) ?? NSImage(),
            target: nil, action: nil
        )
        close.isBordered = false
        close.contentTintColor = .secondaryLabelColor
        close.symbolConfiguration = .init(pointSize: 13, weight: .medium)
        let target = ClosureTarget { [weak window] in window?.closeSheet() }
        close.target = target
        close.action = #selector(ClosureTarget.fire)
        closeTarget = target

        let scroll = NSTextView.scrollableTextView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        if let textView = scroll.documentView as? NSTextView {
            textView.isEditable = false
            textView.isSelectable = true
            textView.drawsBackground = false
            textView.isRichText = true
            textView.textContainerInset = NSSize(width: 19, height: 0)
            textView.textStorage?.setAttributedString(PrivacyPolicy.attributedText())
        }

        for view in [title, close, scroll] {
            view.translatesAutoresizingMaskIntoConstraints = false
            content.addSubview(view)
        }
        NSLayoutConstraint.activate([
            title.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            title.topAnchor.constraint(equalTo: content.topAnchor, constant: 24),
            close.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
            close.firstBaselineAnchor.constraint(equalTo: title.firstBaselineAnchor),
            scroll.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 12),
            scroll.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -20)
        ])
        return content
    }
}

/// Esc reaches the window through the responder chain even while the text
/// view has focus, and closes the sheet.
private final class PolicySheetWindow: NSWindow {
    override func cancelOperation(_ sender: Any?) {
        closeSheet()
    }

    func closeSheet() {
        sheetParent?.endSheet(self)
    }
}
