//! The privacy policy, in the shape of the macOS pet's (`PrivacyPolicy.swift`)
//! and worded for what this Windows version actually does. Every claim is a
//! promise about the code: if a feature changes what is read, stored or sent,
//! this text changes with it.

use crate::strings::{Language, language};

pub fn title() -> &'static str {
    match language() {
        Language::Chinese => "Privacy Policy 隐私政策",
        Language::English => "Privacy Policy",
    }
}

/// (heading, body) pairs; the body's lines are paragraphs.
pub fn sections() -> Vec<(Option<String>, String)> {
    let s = |h: Option<&str>, b: &str| (h.map(str::to_string), b.to_string());
    match language() {
        Language::Chinese => vec![
            s(None, "使用本软件（以下称 TypePal）即表示你理解并同意本隐私政策。"),
            s(
                Some("一、我们收集的信息"),
                "TypePal 不会收集、存储或上传你的任何信息。它完全在你的电脑本地运行，运行时不会发起任何网络请求。",
            ),
            s(
                Some("二、系统权限与输入感知"),
                "TypePal 不需要管理员权限，也不安装任何键盘或鼠标钩子。为了对你的操作做出反应，它只使用 Windows 向所有应用公开的以下信息：\n\
                 1. 打字反应：只读取系统提供的「最近一次操作发生的时间」，并排除鼠标的操作，用来判断你是否正在打字。它不接收按键事件，无法得知你按了哪个键、输入了什么内容，也不会记录。\n\
                 2. 鼠标点击反应：只在你按下鼠标按键时得知「发生了一次点击」，并判断是否点在 TypePal 自己身上，不记录点击的位置和所在的应用。\n\
                 3. 点击与抚摸：光标在 TypePal 身上移动时读取光标的位置，只用来判断你是点到了它还是在抚摸它，不记录光标的移动轨迹。\n\
                 4. 以上信息只在内存中即时使用，用完即弃，不写入磁盘，也不会发送到任何地方。",
            ),
            s(
                Some("三、本地存储"),
                "TypePal 把你的设置（桌宠大小、永远置顶、锁定位置、鼠标穿透、图标常驻、语言）以及它在屏幕上的位置，保存在本机的「%APPDATA%\\TypePal」文件夹中，仅用于下次启动时恢复。这些数据只存在于你自己的电脑上，不会上传；删除本软件后，可删除该文件夹彻底清除。\n\
                 「开机时自动启动」写在当前用户的系统启动项中，你可以随时在本设置或 Windows「设置 › 应用 › 启动」中关闭。TypePal 的图片和配置打包在程序文件内部，它不会读取你电脑上的其他文件。",
            ),
            s(None, "本政策可能随功能更新而调整，如有重大变更会在项目主页说明。"),
        ],
        Language::English => vec![
            s(None, "By using this app (\"TypePal\"), you understand and agree to this privacy policy."),
            s(
                Some("1. Information we collect"),
                "TypePal does not collect, store or upload any of your information. It runs entirely on your computer and makes no network requests.",
            ),
            s(
                Some("2. System permissions and input awareness"),
                "TypePal needs no administrator rights and installs no keyboard or mouse hooks. To react to what you do, it uses only the following information, which Windows makes available to every app:\n\
                 1. Typing: it reads only \"when you last used the computer\", provided by the system, and leaves out mouse activity, to tell whether you are typing. It receives no key events, cannot see which keys you press or what you type, and records nothing.\n\
                 2. Mouse clicks: it learns only that \"a click happened\" when you press a mouse button, and whether it was on TypePal itself. It does not record where you clicked or in which app.\n\
                 3. Clicking and petting: when the pointer moves over TypePal, it reads where the pointer is, only to tell whether you clicked it or are petting it. It does not record where the pointer has been.\n\
                 4. All of the above is used in memory at that moment and then discarded. None of it is written to disk or sent anywhere.",
            ),
            s(
                Some("3. Local storage"),
                "Your settings (pet size, always on top, lock position, click-through, icon placement, language) and TypePal's position on screen are kept in the \"%APPDATA%\\TypePal\" folder on your computer, only so they can be restored next time. They stay on your computer and are never uploaded. After deleting the app, you can remove them completely by deleting that folder.\n\
                 \"Launch at Login\" is kept in your user account's startup items and can be turned off here or in Windows Settings › Apps › Startup at any time. TypePal's images and configuration are packaged inside the program file; it does not read any other files on your computer.",
            ),
            s(None, "This policy may change as features are updated. Significant changes will be announced on the project page."),
        ],
    }
}
