# 上海图书馆图书检索

基于上海图书馆 VuFind 系统的图书检索工具，提供 Web 版和桌面版两种使用方式。

## 功能

- **图书检索** — 支持题名、作者、ISBN、索书号、出版社等多字段搜索
- **图书详情** — 展示书目信息与馆藏状态（可借/在馆/借出）
- **借阅排行** — 成人榜/少儿榜，月度/年度，按中图法分类筛选
- **阅读报告** — 2023-2025 年度数据可视化（纯 SVG 渲染）
- **搜索历史 & 收藏** — 本地存储，桌面版使用 SQLite
- **自动更新** — 桌面版启动时检查 GitHub Releases 新版本
- **调试模式** — 桌面版 `--debug` 启动，开启控制台与 DevTools

## 两种使用方式

### Web 版（Cloudflare Workers）

在线部署，无需安装，浏览器直接访问。

```bash
# 本地开发
npm install
npm run dev

# 部署到 Cloudflare
npm run deploy
```

### 桌面版（Go + WebView2）

Windows 单文件 exe，双击即用。

```bash
cd desktop

# 安装依赖
go mod tidy

# 构建 Release 版（无控制台窗口）
go build -ldflags="-H windowsgui" -o shlib-desktop.exe .

# 构建 Debug 版（带控制台和 DevTools）
go build -o shlib-desktop-debug.exe .
```

运行 Debug 版：

```bash
shlib-desktop-debug.exe --debug
```

## 项目结构

```
├── src/                    # Web 后端 (TypeScript)
│   ├── index.ts            # Cloudflare Workers 入口 & 路由
│   ├── library-client.ts   # 上海图书馆 API 客户端
│   └── parser.ts           # HTML 解析器
├── public/                 # Web 前端 (HTML/CSS/JS)
│   ├── index.html          # 首页（阅读报告）
│   ├── search.html         # 搜索页
│   ├── record.html         # 图书详情页
│   ├── css/                # 样式
│   └── js/                 # 脚本
├── desktop/                # 桌面应用 (Go)
│   ├── frontend/           # 嵌入式前端 (单个 index.html)
│   ├── main.go             # 入口 + WebView2 窗口
│   ├── server.go           # 本地 HTTP 服务器 & API
│   ├── parser.go           # HTML 解析器（从 TS 移植）
│   ├── storage.go          # SQLite 存储（历史 + 收藏）
│   ├── updater.go          # GitHub 自动更新检查
│   ├── embed.go            # go:embed 指令
│   ├── icon.ico            # 应用图标
│   ├── rsrc.syso           # Windows 资源文件（图标）
│   ├── build-debug.bat     # 构建 Debug 版
│   └── build-release.bat   # 构建 Release 版
├── cli.js                  # CLI 工具入口
├── wrangler.toml           # Cloudflare Workers 配置
└── package.json
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/search?q=&type=&page=` | GET | 搜索图书 |
| `/api/detail/{recordId}` | GET | 图书详情 |
| `/api/holdings/{recordId}` | GET | 馆藏信息 |
| `/api/record/{recordId}` | GET | 完整记录（详情+馆藏） |
| `/api/cover/{recordId}` | GET | 封面图片 URL |
| `/api/ranking/categories` | GET | 排行榜分类列表 |
| `/api/ranking?type=&date=&clc=&lan=` | GET | 排行榜数据 |
| `/api/ranking/lookup?isbn=&title=` | GET | 通过 ISBN/书名查找记录 ID |

桌面版额外端点：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/history` | GET/POST | 搜索历史 |
| `/api/history/{id}` | DELETE | 删除历史记录 |
| `/api/bookmarks` | GET/POST | 收藏列表 |
| `/api/bookmarks/{id}` | DELETE | 删除收藏 |
| `/api/update` | GET | 检查版本更新 |

## Web 部署

1. 安装依赖：`npm install`
2. 登录 Cloudflare：`npx wrangler login`
3. 部署：`npm run deploy`

需要配置 Cloudflare Workers 的 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`。

## 桌面版构建

前置要求：

- Go 1.22+
- Windows 10/11（WebView2 运行时，Win10 已预装）

```bash
cd desktop
go mod tidy

# Release（无控制台）
go build -ldflags="-H windowsgui" -o shlib-desktop.exe .

# Debug（带控制台）
go build -o shlib-desktop-debug.exe .
```

## 数据来源

- 图书检索：[上海图书馆 VuFind](https://vufind.library.sh.cn/) HTML 解析 + `/api/v1/search` JSON API
- 借阅排行：[上海图书馆官网](https://www.library.sh.cn) API（AAT Token 鉴权）

## License

[Apache-2.0](LICENSE)
