import type { PetState } from "../model/types";
import type { Issue } from "../model/validate";
import type { BuiltInEffect } from "../model/template";
import type { Frequency } from "../model/types";

export type Lang = "zh" | "en";

const LANG_KEY = "typepal-maker-lang";

/** The language last chosen in the Maker, or else the system's. */
export function defaultLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "zh" || saved === "en") return saved;
  } catch {
    // Storage can be unavailable (private windows); the system's will do.
  }
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function rememberLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Not remembered this time; nothing else depends on it.
  }
}

/** Every string in the editor, Chinese and English side by side. The state
 *  names match the pet's own vocabulary (see player Localization.swift). */
const zh = {
  language: "语言",
  langNames: { zh: "中文", en: "English" } satisfies Record<Lang, string>,

  create: "创作",
  template: "模板",
  import: "导入",
  recent: "最近创作",
  deleteDraft: "删除",
  deleteDraftTitle: (name: string) => `删除「${name}」？`,
  deleteDraftBody: "这个工程会被彻底删除，无法恢复。",
  templateName: "TypePal 小团子",
  untitled: "我的桌宠",

  createTitle: "新建一只桌宠",
  projectName: "桌宠名字",
  width: "宽度",
  height: "高度",
  frameRate: "帧速率",
  startCreating: "开始创作",
  close: "关闭",

  backHome: "返回首页",
  autosaved: "所有更改已自动保存",
  exportProject: "导出工程",
  previewPet: "预览桌宠",
  generateMac: "生成Mac桌宠",
  generateWindows: "生成Windows桌宠",
  generatePet: "生成桌宠",
  generating: "正在生成…",
  chooseOutputDir: "选择桌宠的保存位置",
  downloadedTitle: "桌宠已下载",
  downloadedBody: (file: string) =>
    `已下载「${file}」，接下来：\n1. 解压文件，然后把解压出的 App 拖进「应用程序」文件夹。\n2. 双击打开。第一次会被 macOS 拦下：先点「完成」，再打开「系统设置 → 隐私与安全性」，在页面下方看到「已阻止使用…」点「仍要打开」。`,
  downloadedBodyWindows: (file: string) =>
    `已下载「${file}」，接下来：\n1. 如果浏览器提示文件不安全，在浏览器的下载列表里选择「保留」。\n2. 解压文件，把解压出的 exe 放到你想放的文件夹。\n3. 双击打开。第一次会被 Windows 拦下：先点「更多信息」，再点「仍要运行」。`,

  general: "通用",
  basicInfo: "基本信息",
  petName: "桌宠名字",
  appIcon: "App 图标",
  chooseImage: "选择图片",
  imageFiles: "图片（PNG、JPG、WebP）",
  projectFiles: "TypePal 工程",
  unsupportedTitle: "图片格式不符合",
  unsupportedBody: "目前只支持 PNG、JPG、WebP 格式图片",
  tooLargeTitle: "图片太大了",
  tooLargeBody: "单张图片不能超过 10 MB",
  iconTitle: "调整 App 图标",
  background: "底色",
  customColor: "自定义颜色",
  done: "完成",
  undo: "撤销",
  redo: "恢复",
  reactions: "动画反应",
  required: "必选",
  nextAnimate: "下一步：制作动画",
  stateNames: {
    idle: "默认",
    typing: "打字",
    mouseClick: "鼠标点击",
    tap: "点宠物",
    pet: "抚摸",
    sleep: "睡眠",
  } satisfies Record<PetState, string>,

  motionPreview: "动作预览",
  play: "播放",
  pause: "暂停",
  zoomIn: "放大预览",
  zoomOut: "缩小预览",
  resetZoom: "还原",
  frame: "画面",
  scale: "缩放",
  moveImage: "移动图像",
  moveStep: (px: number) => `每次 ${px} px`,
  moveUp: "向上移动",
  moveDown: "向下移动",
  moveLeft: "向左移动",
  moveRight: "向右移动",
  moveCenter: "位置归零",
  rotation: "旋转",
  reset: "复位",
  timeline: "时间轴",
  oneSecond: (fps: number) => `1 秒 = ${fps} 帧`,
  frameWidth: "帧宽",
  narrower: "缩小帧宽",
  wider: "放大帧宽",
  frames: (n: number) => `${n} 帧`,
  addFrames: "添加图片",
  deleteFrame: "删除",
  extendFrame: "拖动以延长",
  sleepIdleFor: "闲置",
  minutesThenSleep: "分钟后进入睡眠",
  addTrack: "新增空白轨道",
  zzzTrack: "Z 特效",
  baseTrack: "团子底图",
  fewerMinutes: "少一分钟",
  moreMinutes: "多一分钟",
  addBuiltInEffect: "新增内置特效",
  effectNames: {
    zzz: "Zzz",
    heart: "爱心",
    sweat: "汗滴",
    anger: "生气",
    raincloud: "伤心",
    question: "疑惑",
    exclamation: "惊讶",
    music: "音符",
    sparkle: "亮晶晶",
  } satisfies Record<BuiltInEffect, string>,
  regularTab: "常规",
  regularBadge: "默认",
  addVariant: "随机小动作",
  newVariantName: (n: number) => `小动作 ${n}`,
  hasLines: "含台词",
  variantName: "小动作名称",
  deleteVariant: (name: string) => `删除小动作：${name}`,
  frequency: "出现频率",
  frequencies: { rare: "很少", sometimes: "偶尔", often: "经常" } satisfies Record<Frequency, string>,
  customFrequency: "自定义",
  everyBefore: "每",
  everyAfter: "分钟随机出现一次",
  shortestMinutes: "最短间隔（分钟）",
  longestMinutes: "最长间隔（分钟）",
  chanceBefore: "每次触发有",
  chanceAfter: "% 的概率换成它",
  chanceLabel: "概率（%）",
  less: "减少",
  more: "增加",
  regularNote: "该反应的默认播放动画",
  noFrequency: "无频率设置",
  lines: "台词",
  addLine: "添加台词",
  linePlaceholder: "输入一句台词",
  deleteLine: (line: string) => `删除台词：${line}`,
  emptyVariantTitle: "沿用常规动画",
  usesRegular: "空着时沿用常规动画",
  emptyVariantBody: "只想冒一句台词的话，这里不用放图",
  linePreview: "随机台词预览",
  variantsBadge: (count: number, lines: boolean) => [count ? `${count} 个随机小动作` : "", lines ? "含台词" : ""].filter(Boolean).join(" · "),
  trackName: "轨道名称",
  renameHint: "双击改名，拖动调整上下顺序",
  newTrackName: (n: number) => `轨道 ${n}`,
  builtInEffectFailed: "内置特效加载失败",
  deleteTrack: "删除轨道",
  deleteTrackNamed: (name: string) => `删除轨道：${name}`,

  issues: {
    noName: "还没给桌宠起名字",
    idleEmpty: "「默认」至少需要一张图片",
    stateEmpty: (s: string) => `「${s}」已开启但还没有图片`,
  },
  previewTitle: "预览桌宠",
  previewHelp: "在这里打字、点击空白处、点桌宠，或在桌宠身上来回移动鼠标，看看它的反应。",
  previewState: "当前状态",
  closePreview: "结束预览",
  generatedTitle: "生成好了！",
  generatedBody: (path: string) => `已保存到 ${path}，双击就能打开。`,
  openNow: "打开它",
  showInFinder: "在访达中显示",
  showInFolder: "在文件夹中显示",
  minimize: "最小化",
  maximize: "最大化",
  restore: "向下还原",
  closeWindow: "关闭",
  existsTitle: "已经有同名的桌宠",
  existsBody: (path: string) => `${path} 已存在，要替换成新生成的吗？原来的设置会保留。`,
  replace: "替换",
  cancel: "取消",
  runningTitle: "旧版本正在运行",
  runningBody: "请先退出正在运行的那只桌宠，再重新生成。",
  failedTitle: "生成失败",
  generateError: (detail: string) => `生成时出了点问题，请重试。\n（${detail}）`,
  networkError: "网络异常，请检查网络或刷新页面后重试。",
  ok: "好",
  openFailed: "无法打开这个文件，它可能不是 TypePal 工程。",
  inUseTitle: "这个工程正在别处编辑",
  inUseBody: "它已在另一个标签页或窗口中打开，请先关掉那边再试。",
  exportFailed: "工程没有导出成功",
};

type Strings = typeof zh;

const en: Strings = {
  language: "Language",
  langNames: { zh: "中文", en: "English" },

  create: "Create",
  template: "Template",
  import: "Import",
  recent: "Recent",
  deleteDraft: "Delete",
  deleteDraftTitle: (name) => `Delete “${name}”?`,
  deleteDraftBody: "This project will be permanently deleted. This can't be undone.",
  templateName: "TypePal Mochi",
  untitled: "My Pet",

  createTitle: "Create a New Pet",
  projectName: "Pet name",
  width: "Width",
  height: "Height",
  frameRate: "Frame rate",
  startCreating: "Start",
  close: "Close",

  backHome: "Home",
  autosaved: "All changes saved",
  exportProject: "Export Project",
  previewPet: "Preview Pet",
  generateMac: "Make Mac Pet",
  generateWindows: "Make Windows Pet",
  generatePet: "Make Pet",
  generating: "Making…",
  chooseOutputDir: "Choose where to save the pet",
  downloadedTitle: "Your pet is downloaded",
  downloadedBody: (file) =>
    `Downloaded “${file}”. Next:\n1. Unzip it, then drag the app into your Applications folder.\n2. Double-click to open. The first time, macOS blocks it: click Done, then open System Settings › Privacy & Security, find “… was blocked” near the bottom and click “Open Anyway”.`,
  downloadedBodyWindows: (file) =>
    `Downloaded “${file}”. Next:\n1. If your browser says the file isn't safe, choose “Keep” in its downloads list.\n2. Unzip it and put the exe in any folder you like.\n3. Double-click to open. The first time, Windows stops it: click “More info”, then “Run anyway”.`,

  general: "General",
  basicInfo: "Basics",
  petName: "Pet name",
  appIcon: "App icon",
  chooseImage: "Choose Image",
  imageFiles: "Images (PNG, JPG, WebP)",
  projectFiles: "TypePal Project",
  unsupportedTitle: "Unsupported image format",
  unsupportedBody: "Only PNG, JPG and WebP images are supported for now",
  tooLargeTitle: "Image too large",
  tooLargeBody: "Images must be 10 MB or smaller",
  iconTitle: "Adjust App Icon",
  background: "Background",
  customColor: "Custom color",
  done: "Done",
  undo: "Undo",
  redo: "Redo",
  reactions: "Reactions",
  required: "Required",
  nextAnimate: "Next: Animate",
  stateNames: { idle: "Idle", typing: "Typing", mouseClick: "Mouse Click", tap: "Tap Pet", pet: "Petting", sleep: "Sleep" },

  motionPreview: "Animation",
  play: "Play",
  pause: "Pause",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  resetZoom: "Reset",
  frame: "Image",
  scale: "Scale",
  moveImage: "Move image",
  moveStep: (px) => `${px} px per step`,
  moveUp: "Move up",
  moveDown: "Move down",
  moveLeft: "Move left",
  moveRight: "Move right",
  moveCenter: "Back to center",
  rotation: "Rotate",
  reset: "Reset",
  timeline: "Timeline",
  oneSecond: (fps) => `1 s = ${fps} frames`,
  frameWidth: "Frame width",
  narrower: "Narrower frames",
  wider: "Wider frames",
  frames: (n) => (n === 1 ? "1 frame" : `${n} frames`),
  addFrames: "Add images",
  deleteFrame: "Delete",
  extendFrame: "Drag to lengthen",
  sleepIdleFor: "Sleep after",
  minutesThenSleep: "minutes idle",
  addTrack: "Add Track",
  zzzTrack: "Z Effect",
  baseTrack: "Pet Base",
  fewerMinutes: "One minute less",
  moreMinutes: "One minute more",
  addBuiltInEffect: "Add Effect",
  effectNames: {
    zzz: "Zzz",
    heart: "Heart",
    sweat: "Sweat",
    anger: "Angry",
    raincloud: "Sad",
    question: "Puzzled",
    exclamation: "Surprised",
    music: "Music",
    sparkle: "Sparkle",
  },
  regularTab: "Regular",
  regularBadge: "Base",
  addVariant: "Random action",
  newVariantName: (n) => `Action ${n}`,
  hasLines: "Has lines",
  variantName: "Action name",
  deleteVariant: (name) => `Delete action: ${name}`,
  frequency: "Frequency",
  frequencies: { rare: "Rare", sometimes: "Sometimes", often: "Often" },
  customFrequency: "Custom",
  everyBefore: "Every",
  everyAfter: "minutes at random",
  shortestMinutes: "Shortest gap (minutes)",
  longestMinutes: "Longest gap (minutes)",
  chanceBefore: "Each time, a",
  chanceAfter: "% chance to play it instead",
  chanceLabel: "Chance (%)",
  less: "Less",
  more: "More",
  regularNote: "The reaction's usual animation",
  noFrequency: "No frequency",
  lines: "Lines",
  addLine: "Add line",
  linePlaceholder: "Add a line",
  deleteLine: (line) => `Delete line: ${line}`,
  emptyVariantTitle: "Uses the regular animation",
  usesRegular: "Left empty, it plays the regular animation",
  emptyVariantBody: "Just want it to say something? No pictures needed here",
  linePreview: "Random line preview",
  variantsBadge: (count, lines) => [count ? `${count} random action${count > 1 ? "s" : ""}` : "", lines ? "has lines" : ""].filter(Boolean).join(" · "),
  trackName: "Track name",
  renameHint: "double-click to rename, drag to reorder",
  newTrackName: (n) => `Track ${n}`,
  builtInEffectFailed: "Could not load the built-in effect",
  deleteTrack: "Delete track",
  deleteTrackNamed: (name) => `Delete track: ${name}`,

  issues: {
    noName: "The pet has no name yet",
    idleEmpty: "“Idle” needs at least one image",
    stateEmpty: (s) => `“${s}” is on but has no images`,
  },
  previewTitle: "Preview Pet",
  previewHelp: "Type here, click empty space, click the pet, or rub the pointer over it to see how it reacts.",
  previewState: "State",
  closePreview: "End Preview",
  generatedTitle: "Done!",
  generatedBody: (path) => `Saved to ${path}. Double-click it to start.`,
  openNow: "Open It",
  showInFinder: "Show in Finder",
  showInFolder: "Show in Folder",
  minimize: "Minimize",
  maximize: "Maximize",
  restore: "Restore Down",
  closeWindow: "Close",
  existsTitle: "A pet with this name already exists",
  existsBody: (path) => `${path} already exists. Replace it with the new one? Your pet's settings will be kept.`,
  replace: "Replace",
  cancel: "Cancel",
  runningTitle: "That pet is running",
  runningBody: "Quit the running pet first, then generate again.",
  failedTitle: "Couldn't make the pet",
  generateError: (detail) => `Something went wrong while making the pet. Please try again.\n(${detail})`,
  networkError: "Network error. Check your connection or reload the page, then try again.",
  ok: "OK",
  openFailed: "This file can't be opened. It may not be a TypePal project.",
  inUseTitle: "This project is open elsewhere",
  inUseBody: "It's already open in another tab or window. Close it there, then try again.",
  exportFailed: "The project couldn't be exported",
};

export const STRINGS: Record<Lang, Strings> = { zh, en };
export type { Strings };

/** What to tell the user about files an upload skipped, if anything: a
 *  fixed message per reason, without file names. */
export function importNotice(t: Strings, result: { tooLarge: string[]; unsupported: string[] }) {
  const wrongFormat = result.unsupported.length > 0;
  const tooLarge = result.tooLarge.length > 0;
  if (!wrongFormat && !tooLarge) return null;
  if (!wrongFormat) return { title: t.tooLargeTitle, body: t.tooLargeBody };
  return { title: t.unsupportedTitle, body: tooLarge ? `${t.unsupportedBody}\n${t.tooLargeBody}` : t.unsupportedBody };
}

export function issueText(t: Strings, issue: Issue): string {
  switch (issue.kind) {
    case "noName":
      return t.issues.noName;
    case "idleEmpty":
      return t.issues.idleEmpty;
    case "stateEmpty":
      return t.issues.stateEmpty(t.stateNames[issue.state]);
  }
}
