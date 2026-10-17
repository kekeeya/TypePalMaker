<p align="center">
  <img src=".github/readme/typepal-idle.gif" alt="TypePal 小团子" width="200">
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/tagline-dark.png">
    <img src=".github/readme/tagline-light.png" alt="Create your own desktop pet." width="360">
  </picture>
</p>

<h1 align="center">TypePal Maker</h1>

<p align="center"><strong>开源桌宠制作器，上传图片自由定制打字桌宠</strong></p>

<p align="center">
  <b>中文</b> | <a href="./README.en.md">English</a>
</p>

<p align="center">
  <a href="#使用方法"><img src="https://img.shields.io/badge/platform-Web%20%7C%20Mac%20%7C%20Windows-blue" alt="Platform"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-green" alt="License"></a>
</p>

<p align="center">
  <a href="https://kekeeya.github.io/TypePalMaker/"><img src="https://img.shields.io/badge/%E7%BD%91%E9%A1%B5%E7%89%88-%E5%9C%A8%E7%BA%BF%E5%88%B6%E4%BD%9C-8c84e4?style=for-the-badge" alt="网页版在线制作"></a>
  <a href="https://github.com/kekeeya/TypePalMaker/releases/latest"><img src="https://img.shields.io/badge/%E6%9C%AC%E5%9C%B0%E7%89%88-%E4%B8%8B%E8%BD%BD%20dmg-46405f?style=for-the-badge&logo=apple&logoColor=white" alt="本地版下载 dmg"></a>
</p>

## 功能

<table>
  <tr><th nowrap>功能</th><th>说明</th></tr>
  <tr><td nowrap>自由配置 5 种反应动画</td><td>默认（待机）、打字、鼠标点击、点宠物、抚摸</td></tr>
  <tr><td nowrap>动画编辑</td><td>自定义帧率，可独立配置动画时间轴上每帧图的时长&顺序，以及图片位置、缩放、旋转；支持撤销 / 重做和实时预览动画效果</td></tr>
  <tr><td nowrap>实时预览效果</td><td>制作器包含实时预览功能，方便你及时调整效果</td></tr>
  <tr><td nowrap>自定义桌宠图标</td><td>默认使用待机状态图片，也可以自由上传定制</td></tr>
  <tr><td nowrap>内置模板</td><td>内置模板桌宠可直接上手修改；工程自动保存本地，也可导出 <code>.typepalproj</code> 本地备份</td></tr>
  <tr><td nowrap>桌宠设置</td><td>生成的桌宠可调开机自启动、大小、置顶、锁定位置、鼠标穿透等</td></tr>
  <tr><td nowrap>隐私友好</td><td>桌宠不申请辅助功能、输入监控等任何系统权限，不联网，也不记录你输入的内容</td></tr>
</table>

## 使用方法

1. 打开网页版或本地版制作器，上传图片，定制你自己的桌宠。网页版点「生成Mac桌宠」或「生成Windows桌宠」；本地版点「生成桌宠」，Mac 版生成 Mac 桌宠，Windows 版生成 Windows 桌宠。
2. 网页版会下载 zip：Mac 桌宠解压后把 App 拖进「应用程序」文件夹，Windows 桌宠解压后把 exe 放到任意文件夹；本地版直接保存到你选择的位置。
3. 双击打开。网页版下载的桌宠第一次打开会被系统拦下：
   - Mac：先点「完成」，再打开「系统设置 → 隐私与安全性」，在页面下方看到「已阻止使用…」后点「仍要打开」。
   - Windows：点「更多信息」，再点「仍要运行」。如果浏览器提示文件不安全，在下载列表里选择「保留」。

   之后就能正常双击打开了。

本地版 TypePal Maker 第一次打开时同样需要放行一次（Mac 在「隐私与安全性」里点「仍要打开」，Windows 点「更多信息 → 仍要运行」）。Windows 版下载 zip 解压后就能用，不需要安装。

## 从源码编译&开发

想要开发更多功能，需要 macOS、Xcode 命令行工具（`xcode-select --install`）、Node.js 和 Rust。

```bash
player/build-app.sh            # 先编译空白桌宠模板
cd maker && npm install
npm run dev                    # 网页版，本地预览
npm run tauri build            # 本地版 TypePalMaker.app
```

在 Windows 上开发不需要 `player/build-app.sh`（它只能在 Mac 上编译 Mac 桌宠模板），需要 Node.js、Rust 和 Visual Studio 生成工具（勾选「使用 C++ 的桌面开发」）：

```bash
cd player-windows && cargo build --release      # 先编译 Windows 桌宠模板
cd ../maker && npm install
npm run dev                    # 网页版，本地预览（只能生成 Windows 桌宠）
npm run tauri build            # 本地版 src-tauri/target/release/typepal-maker.exe
```

## 声明

桌宠和 Maker 都只在你自己的电脑上运行，图片和工程不会上传到任何服务器，详见 Maker 里的隐私政策；Mac App 没有经过 Apple 公证、Windows 程序没有代码签名，所以第一次打开需要手动放行；代码以 [GPL-3.0](LICENSE) 协议开源。
