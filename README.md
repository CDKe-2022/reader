# 📖 Minimalist Reader

一个极轻量、极纯净的 **TXT 小说阅读器**，基于 Cloudflare Workers 全家桶构建。

![Version](https://img.shields.io/badge/version-1.3.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## ✨ 特性

### 🎨 极简美学 (v1.4)
- **沉浸式阅读**：专为长文本优化的排版，支持**系统衬线体**（宋体）与无衬线体切换。
- **OLED 纯黑模式**：专为 OLED 屏幕设计的纯黑背景（#000000），极致省电且护眼。
- **拟态质感 UI**：现代化的卡片设计，微妙的阴影与交互反馈，视觉体验细腻。
- **响应式设计**：完美适配手机端、平板与桌面端。

### ⚡ 性能与架构
- **秒开体验**：利用 IndexedDB 本地全量缓存，二次打开无需下载与解析。
- **前端智能解析**：将高消耗的正则解析逻辑转移至客户端，彻底解决 Cloudflare Workers CPU 限制问题。
- **模块化代码**：采用状态管理与 Worker 模块化设计，代码结构清晰，易于维护。
- **零依赖**：原生 JavaScript/HTML/CSS，无任何第三方库，体积微小。

### 💾 云端同步
- 基于 Cloudflare **R2** 存储 TXT 原文件，**D1** 存储元数据（进度、目录）。
- 随时随地通过浏览器访问，数据随身携带。

## 🛠️ 技术栈

- **Frontend**: HTML5, CSS3 (Variables), Vanilla JS (ES6+), IndexedDB
- **Backend**: Cloudflare Workers
- **Storage**: Cloudflare R2 (Object Storage), Cloudflare D1 (SQLite Database)
- **Architecture**: Serverless (Jamstack)

## 🚀 快速开始

本项目专为 Cloudflare Pages 或 Cloudflare Workers 设计。请按以下步骤部署：

### 1. 创建 Cloudflare 资源

在 Cloudflare Dashboard 中创建以下资源：
- 一个 **Worker**（建议名称：`minimalist-reader`）
- 一个 **R2 Bucket**（建议名称：`reader-books`）
- 一个 **D1 Database**（建议名称：`reader-db`）

### 2. 初始化数据库

进入创建的 **D1 Database** 控制台，点击 `Console`，执行以下 SQL 语句：
sql
CREATE TABLE IF NOT EXISTS books (
id TEXT PRIMARY KEY,
name TEXT NOT NULL,
r2_key TEXT NOT NULL,
word_count INTEGER DEFAULT 0,
total_chapters INTEGER DEFAULT 0,
total_paragraphs INTEGER DEFAULT 0,
progress_gidx INTEGER DEFAULT 0,
current_chapter_title TEXT DEFAULT ‘’,
ch_map TEXT DEFAULT ‘[]’,
import_time INTEGER NOT NULL,
sort_order INTEGER DEFAULT 0
);

### 3. 配置 Worker 绑定

编辑你的 `wrangler.toml` 文件，将 R2 和 D1 绑定到 Worker：

toml
name = “minimalist-reader”
main = “_worker.js”
compatibility_date = “2024-01-01”

[[r2_buckets]]
binding = “BUCKET”
bucket_name = “reader-books” # 替换为你的 R2 Bucket 名称

[[d1_databases]]
binding = “DB”
database_name = “reader-db” # 替换为你的 D1 Database 名称
database_id = “your-database-id” # 替换为你的 D1 ID


或者直接在 Cloudflare Dashboard 的 Worker 设置 -> Settings -> Variables -> Bindings 中添加：
- **Variable Name**: `BUCKET` -> Type: R2 Bucket -> 选择你的 Bucket
- **Variable Name**: `DB` -> Type: D1 Database -> 选择你的 Database

### 4. 部署代码

1. 将 `_worker.js` 的内容粘贴到 Worker 的编辑器中。
2. 点击 **Save and Deploy**。
3. (可选) 如果使用 Custom Domains，可以在 Worker 的 Triggers -> Custom Domains 中绑定你的域名。

## 📱 使用指南

1. **导入书籍**：点击书架右上角的“+ 导入”按钮，选择本地的 TXT 文件。
   - *注意：为了最佳体验，建议导入 10MB 以内的文件。*
2. **阅读**：点击书籍卡片开始阅读。
   - **双击/点击中间区域**：隐藏/显示顶部菜单。
   - **侧滑**：呼出设置面板。
3. **设置**：
   - **字体**：支持切换无衬线（现代）与衬线（纸质书质感）。
   - **主题**：包含“暖灰纸”与“纯黑 OLED”模式。
   - **字号/行距**：自定义阅读舒适度。
4. **云端同步**：你的阅读进度会在切换设备或清理缓存后自动从云端同步。

## 🧠 架构设计思路

### 为什么 Worker 不解析文本？
Cloudflare Workers 的免费套餐对 CPU 时间限制较严格（通常为 10ms-50ms）。解析 10MB 的 TXT 文本并进行正则匹配极易导致超时。

**v1.3 解决方案**：
- **前端解析**：利用用户设备的算力进行正则解析和结构化（生成 `paragraphs` 数组）。
- **前端缓存**：解析结果直接存入 IndexedDB，下次打开“秒读”，无需重新解析。
- **后端搬运**：Worker 仅负责接收 `FormData`，将文件流原样存入 R2，不消耗计算资源。

这种“弱服务端，强客户端”的架构，既保证了极致的性能，又完全规避了 Cloudflare 的限制，实现了真正的零成本稳定运行。

## 🗺️ 后续计划

- [ ] **全书搜索**：基于本地 IndexedDB 的毫秒级全文检索。
- [ ] **自定义正则**：支持用户自定义章节匹配规则，适配所有格式。
- [ ] **PWA 支持**：添加 Manifest，支持安装为桌面/手机应用。
- [ ] **TTS 朗读**：利用浏览器原生语音合成 API 实现听书。

## 📄 License

MIT License

---

**Made with ❤️ by [AI]**

