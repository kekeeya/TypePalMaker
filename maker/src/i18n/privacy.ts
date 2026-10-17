import type { Lang } from "./strings";

/**
 * The Maker's privacy policy, in the shape of the pet's own (player
 * PrivacyPolicy.swift): numbered sections and a closing note. Every claim is
 * a promise about the code — if a feature changes what is read, stored or
 * sent, this text changes with it.
 */
export interface PolicySection {
  heading?: string;
  body: string;
}

export const POLICY_TITLE: Record<Lang, string> = { zh: "Privacy Policy 隐私政策", en: "Privacy Policy" };

export const POLICY: Record<Lang, PolicySection[]> = {
  zh: [
    { body: "使用本软件（以下称 TypePalMaker）即表示你同意本隐私政策。" },
    {
      heading: "一、我们收集的信息",
      body: `1. TypePalMaker：不会收集、存储或上传你的任何信息。你添加的图片和制作的工程只在你自己的电脑上存储和处理；网页版也只存在你的浏览器里，不会上传。
2. 用它制作的桌宠（以下称 TypePal）：同样不会收集、存储或上传你的任何信息。它完全在你的电脑本地运行，运行时不会发起任何网络请求。`,
    },
    {
      heading: "二、TypePal 的系统权限与输入感知",
      body: `TypePal 不申请任何系统权限（包括辅助功能、输入监控、屏幕录制等）；在 Windows 上也不需要管理员权限，不安装任何键盘或鼠标钩子。为了对你的操作做出反应，它只使用 macOS / Windows 向所有应用公开的以下信息：
1. 打字反应：在 Mac 上只读取系统提供的「距离上一次按键过去了多久」；在 Windows 上只读取「最近一次操作发生的时间」，并排除鼠标的操作。都只用来判断你是否正在打字，无法得知你按了哪个键、输入了什么内容，也不会记录。
2. 鼠标点击反应：只在你按下鼠标按键时得知「发生了一次点击」（在 Windows 上还会判断是否点在 TypePal 自己身上），不记录点击的位置和所在的应用。
3. 点击与抚摸：鼠标移动时读取光标当前的位置，只用来判断光标是否落在 TypePal 身上（以区分你是点到了它还是在抚摸它），不记录光标的移动轨迹。
4. 以上信息只在内存中即时使用，用完即弃，不写入磁盘，也不会发送到任何地方。`,
    },
    {
      heading: "三、本地存储",
      body: `1. 本地版：自动保存的工程只存在本机的「~/Library/Application Support/io.typepal.maker」（Mac）或「%APPDATA%\\io.typepal.maker」（Windows）目录。在「最近创作」里删除工程，即会彻底清除它的数据。
2. 网页版：工程和图片只存在你浏览器的本地存储里，不会上传。在「最近创作」里删除工程，即会清除它的数据；清除浏览器的网站数据会删除所有工程，建议及时导出工程备份。`,
    },
    {
      heading: "四、系统权限",
      body: "本地版只读写你自己选择的文件和文件夹，生成的桌宠保存在你选择的位置。网页版不需要任何权限，生成的桌宠会直接下载到你的电脑。",
    },
    { body: "本政策可能随功能更新而调整，如有重大变更会在项目主页说明。" },
  ],
  en: [
    { body: "By using this app (\"TypePalMaker\"), you agree to this privacy policy." },
    {
      heading: "1. Information we collect",
      body: `1. TypePalMaker does not collect, store or upload any of your information. The images you add and the projects you make are stored and processed only on your own computer; in the web version they stay in your browser and are never uploaded.
2. The pets you make with it ("TypePal") do not collect, store or upload any of your information either. They run entirely on your computer and make no network requests.`,
    },
    {
      heading: "2. TypePal's permissions and input awareness",
      body: `TypePal asks for no system permissions (no Accessibility, Input Monitoring or Screen Recording); on Windows it also needs no administrator rights and installs no keyboard or mouse hooks. To react to what you do, it uses only the following information, which macOS and Windows make available to every app:
1. Typing: on a Mac it reads only "how long since the last key press", provided by the system; on Windows only "when you last used the computer", leaving out mouse activity. Either way it only tells whether you are typing: it cannot see which keys you press or what you type, and records nothing.
2. Mouse clicks: it learns only that "a click happened" when you press a mouse button (on Windows, also whether it was on TypePal itself). It does not record where you clicked or in which app.
3. Clicking and petting: when the mouse moves, it reads where the pointer is, only to tell whether it is over TypePal (so it knows whether you clicked it or are petting it). It does not record where the pointer has been.
4. All of the above is used in memory at that moment and then discarded. None of it is written to disk or sent anywhere.`,
    },
    {
      heading: "3. Local storage",
      body: `1. Desktop version: autosaved projects stay on your computer, in "~/Library/Application Support/io.typepal.maker" (Mac) or "%APPDATA%\\io.typepal.maker" (Windows). Deleting a project from Recent removes its data completely.
2. Web version: projects and images stay only in your browser's local storage and are never uploaded. Deleting a project from Recent removes its data; clearing the browser's site data deletes all projects, so export the ones you want to keep.`,
    },
    {
      heading: "4. System permissions",
      body: "The desktop version only reads and writes the files and folders you choose; generated pets are saved where you choose. The web version needs no permissions; generated pets are downloaded straight to your computer.",
    },
    { body: "This policy may change as features are updated. Significant changes will be announced on the project page." },
  ],
};
