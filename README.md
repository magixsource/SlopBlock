# SlopBlock

一个用于 Bilibili 的浏览器扩展：按 UP 主屏蔽视频卡片，让首页、搜索页和播放页推荐里不再出现不想看的内容。

## 功能

- **右键屏蔽**：在 B 站任意视频卡片上右键 →「屏蔽此UP主」。扩展会通过视频 BV 号反查 UP 主 ID 并加入屏蔽列表。
- **实时过滤**：首页/搜索页的 `.bili-video-card` 和播放页侧栏的 `.video-page-card-small` 会被替换成灰色占位提示；DOM 变化和 storage 变化都会即时生效，无需刷新页面。
- **弹窗管理**：弹窗里以「昵称 + ID」形式分页展示已屏蔽的 UP 主，可单条移除。昵称会自动查询并缓存。
- **公共清单**：设置页支持导入、导出、分享公共屏蔽清单，也可以一键恢复使用内置的 `data/data.json`。
- **合并策略**：最终清单 =（公共清单 − 已移除的公共 ID）∪ 用户个人添加的集合。用户移除过的公共 ID 在未来更新中不会重新出现。

## 安装

项目是纯静态的 Manifest V3 扩展，没有构建步骤。

### 方式一：从 GitHub Release 下载（推荐给普通用户）

在仓库的 [Releases](https://github.com/magixsource/SlopBlock/releases) 页面下载最新的 `SlopBlock-<版本>.zip`，然后：

1. 解压到一个**固定文件夹**（不要删除，Chrome 会一直从这个目录加载扩展）
2. 打开 `chrome://extensions`
3. 开启右上角「开发者模式」
4. 点击「加载已解压的扩展程序」，选择**解压后包含 `manifest.json` 的那个文件夹**
5. 可在工具栏的扩展菜单里把 SlopBlock 固定显示

更新时，下载新版 ZIP 解压到新文件夹，重复第 4 步加载，再删除或禁用旧版本即可。

> Chrome 133+ 下，以「已解压」方式加载的扩展必须保持开发者模式开启，否则会被禁用。

English: extract the ZIP to a permanent folder, open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and select the folder containing `manifest.json`.

> 为什么不提供 `.crx`：从 Chrome 75 起，普通桌面版 Chrome 只接受 Chrome Web Store 签名的 CRX，自制的 CRX 会报 `CRX_REQUIRED_PROOF_MISSING`，用户下载了也装不上。ZIP + 加载已解压是当前最可靠的分发方式。

### 方式二：从源码加载

先克隆仓库再加载：

```bash
git clone git@github.com:magixsource/SlopBlock.git
```

然后在 `chrome://extensions` 开启开发者模式，选择项目根目录（包含 `manifest.json` 的那一层）。

### 打包发布包

维护者可以用脚本生成发布用 ZIP：

```bash
bash scripts/package.sh
```

GitHub Actions 在推送 `v*` 标签时会自动打包并把 ZIP 附加到 Release 上。

## 使用

- **添加屏蔽**：在 B 站视频卡片上右键 →「屏蔽此UP主」；或在弹窗里查看列表。
- **移除屏蔽**：点开工具栏图标，在列表里点对应行的「移除」。
- **导入公共清单**：点弹窗右上角的 ⚙，或在 `chrome://extensions` 的扩展详情里进入「扩展选项」。支持粘贴 ID（分号/逗号/换行分隔）、粘贴 `data.json` 格式的 JSON，或从文件导入。

## 项目结构

```
.
├── manifest.json          # MV3 配置：权限、菜单、内容脚本、设置页
├── background_script.js   # Service Worker：右键菜单、公共清单同步与合并、BV 号反查
├── js/slopblock.js        # 内容脚本：DOM 过滤、占位卡片、storage 监听
├── popup.html / popup.js  # 工具栏弹窗：分页列表、移除、设置入口
├── options.html / options.js # 设置页：公共清单导入/导出/恢复内置
├── data/data.json         # 内置公共清单 { bili: { version, block, unblock } }
└── images/                # 各尺寸图标与 SVG 源文件
```

## 存储设计

扩展使用 `chrome.storage.local`，关键字段：

| Key | 说明 |
| --- | --- |
| `localFilterList` | 最终生效的屏蔽清单（分号分隔的 ID），所有过滤逻辑都读它 |
| `publicFilterList` | 当前生效的公共清单 |
| `userFilterList` | 用户通过右键添加的个人清单 |
| `excludedIds` | 用户从公共清单中移除过的 ID（墓碑） |
| `publicDataVersion` | 公共清单版本，用于判断是否需要重新合并 |
| `publicSource` | 公共清单来源：`builtin` 或 `imported` |
| `importedPublicList` / `importedPublicVersion` | 用户在设置页导入的清单与版本标记 |
| `ownerNameCache` | UP 主 ID → 昵称的缓存 |

远程 URL 拉取公共清单属于后续规划，目前公共清单来自包内静态 `data.json` 或用户在设置页导入的内容。

## 开发

- 修改源码后，在 `chrome://extensions` 点扩展的「重新加载」即可；B 站页面需要 F5 重新注入内容脚本。
- 图标源文件在 `images/icon-source.svg`（标准）和 `images/icon-source-small.svg`（16px 简化版）。`images/make-transparent.py` 用于在 macOS 上把 Quick Look 渲染结果的白底抠成透明底。
- 项目未包含 LICENSE，可按需添加。
