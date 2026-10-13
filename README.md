<div align="center">

# TypePal Maker

[![Pet Platform](https://img.shields.io/badge/pet%20platform-macOS%2013%2B-black)](#使用方法)
[![Maker Platform](https://img.shields.io/badge/maker%20platform-Web%20%7C%20Mac-blue)](#使用方法)
[![License](https://img.shields.io/badge/license-GPL--3.0-green)](LICENSE)

[![简体中文](https://img.shields.io/badge/%E8%AF%AD%E8%A8%80-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-3b3b5c)](README.md)
[![English](https://img.shields.io/badge/lang-English-lightgrey)](README.en.md)

**整体零代码！上传图片自由定制Mac打字桌宠！**

</div>

<p align="center"><img src=".github/readme/banner-en.jpg" alt="TypePal Maker" width="70%"></p>

<div align="center">

| 可用版本 | 说明 |
|:---:|:---:|
| 网页版 | 直接访问 [kekeeya.github.io/TypePalMaker](https://kekeeya.github.io/TypePalMaker/) 制作桌宠&下载 |
| 本地版 | 从 [Releases](https://github.com/kekeeya/TypePalMaker/releases) 下载最新的 `.dmg` 离线制作 |

</div>

## 功能

| 功能 | 说明 |
|---|---|
| 自由配置 5 种反应动画 | 默认（待机）、打字、鼠标点击、点宠物、抚摸 |
| 动画编辑 | 自定义帧率，可独立配置动画时间轴上每帧图的时长&顺序，以及图片位置、缩放、旋转；支持撤销 / 重做和实时预览动画效果|
| 实时预览效果 | 制作器包含实时预览功能，方便你及时调整效果 |
| 自定义桌宠图标 | 默认使用待机状态图片，也可以自由上传定制 |
| 内置模板 | 内置模板桌宠可直接上手修改；工程自动保存本地，也可导出 `.typepalproj` 本地备份 |
| 桌宠设置 | 生成的桌宠可调开机自启动、大小、置顶、锁定位置、鼠标穿透等 |
| 隐私友好 | 桌宠不申请辅助功能、输入监控等任何系统权限，不联网，也不记录你输入的内容 |

## 使用方法

1. 打开网页版或本地版制作器，上传图片，定制你自己的桌宠，点「生成 App」。
2. 网页版会下载 zip，解压后把桌宠 App 拖进「应用程序」文件夹；本地版直接保存桌宠 App 到你选择的位置。
3. 双击打开。网页版下载的桌宠第一次打开会被 macOS 拦下：先点「完成」，再打开「系统设置 → 隐私与安全性」，在页面下方看到「已阻止使用…」后点「仍要打开」。之后就能正常双击打开了。

本地版 TypePal Maker 第一次打开时同样需要在「隐私与安全性」里点一次「仍要打开」。

## 从源码编译&开发

想要开发更多功能，需要 macOS、Xcode 命令行工具（`xcode-select --install`）、Node.js 和 Rust。

```bash
player/build-app.sh            # 先编译空白桌宠模板
cd maker && npm install
npm run dev                    # 网页版，本地预览
npm run tauri build            # 本地版 TypePalMaker.app
```

## 声明

桌宠和 Maker 都只在你自己的电脑上运行，图片和工程不会上传到任何服务器，详见 Maker 里的隐私政策；App 没有经过 Apple 公证，所以第一次打开需要手动放行；代码以 [GPL-3.0](LICENSE) 协议开源。
