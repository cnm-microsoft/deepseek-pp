# DeepSeek++

为 [DeepSeek](https://chat.deepseek.com) 网页版注入 **类原生工具调用**、**Agentic 记忆系统**、**Skill 技能系统**、**系统提示词预设** 和 **自动化任务** 的 Chrome 扩展。

让 DeepSeek 像支持原生 tools 一样自动执行记忆保存、更新、删除等动作，拥有跨对话长期记忆，并通过 `/skill` 指令一键切换专家模式；也可以像 Codex 自动化一样，把固定 prompt 放进独立会话里立即运行或按计划重复执行。

## 核心功能

### 类原生工具调用

- **XML 工具协议** — 在 prompt 中向模型注入 `memory_save`、`memory_update`、`memory_delete` 等工具 schema，模型按 `<tool_name>{JSON}</tool_name>` 输出调用请求
- **流式拦截执行** — 扩展在 SSE 响应流中实时识别工具调用，自动转发给 Content Script 执行，不需要用户复制或手动确认
- **隐藏原始调用** — 页面不会暴露 XML/JSON 工具块；工具调用会从正文、历史消息和 IndexedDB 缓存中清理
- **DeepSeek 原生观感** — 执行结果渲染成类似「已思考」的折叠区块，例如「已执行工具（2次）」并逐条展示 `memory_save 已保存 · 宠物信息`
- **多工具连续执行** — 同一条回复可以执行多次工具调用，适合把多个独立事实分别保存为多条记忆
- **刷新后恢复** — 工具执行记录会短期持久化，并在刷新会话后恢复展示，避免刚执行完的工具状态消失
- **历史兼容** — 新 XML 协议和旧 DSML 工具调用历史都能被解析、清理和恢复

<p align="center">
  <img src="assets/yuansheng.jpg" width="300" alt="记忆管理侧边栏">
</p>

### 记忆系统

- **自动记忆** — AI 在对话中识别到关键信息时，通过 `memory_save` 工具自动保存为长期记忆
- **智能注入** — 每次对话时，根据关键词匹配、置顶权重、访问频率等维度，自动筛选相关记忆注入 prompt
- **四种类型** — 用户画像 (`user`)、行为反馈 (`feedback`)、话题上下文 (`topic`)、参考资料 (`reference`)
- **侧边栏管理** — 查看、编辑、置顶、删除记忆，支持按类型筛选和标签管理
- **导入/导出** — JSON 格式批量备份和恢复

<p align="center">
  <img src="assets/screenshot-sidepanel-memory.png" width="300" alt="记忆管理侧边栏">
</p>

### Skill 技能系统

- **内置技能** — 预设 9 个开箱即用的技能：极致深度思考、前端设计、文档协作、品牌指南、算法艺术、PPT 设计等
- **自定义技能** — 在侧边栏创建专属技能，定义系统指令和参数
- **`/` 触发** — 在聊天框输入 `/` 弹出自动补全面板，选择技能后自动注入对应的 system prompt
- **记忆联动** — 技能可选择是否同时注入记忆上下文

<p align="center">
  <img src="assets/screenshot-skill-popup.png" width="600" alt="技能自动补全弹窗">
  <br>
  <img src="assets/screenshot-sidepanel-skill.png" width="300" alt="技能管理侧边栏">
</p>

### 系统提示词预设

- **自定义预设** — 在侧边栏创建多个系统提示词预设，定义全局角色设定或行为指令
- **一键激活** — 同一时间只有一个预设处于激活状态，激活后自动生效
- **首条注入** — 每次新对话的首条消息前自动注入激活预设的内容，后续消息不重复注入
- **与技能/记忆共存** — 预设内容作为前缀注入，与 Skill 指令和记忆上下文叠加生效

### 自动化任务

- **像 Codex 自动化一样运行** — 在侧边栏「自动化」页创建任务，点击「立即运行」即可把 prompt 发送到 DeepSeek，也可以启用定时频率自动触发
- **每个任务独立会话** — 首次运行会创建独立 DeepSeek 会话，后续运行保存并复用该任务自己的 `chat_session_id` 和最新父消息，适合连续追踪同一主题
- **支持 cron / RRULE** — 支持手动、5 字段 cron（如 `0 9 * * *`）和简化 RRULE（如 `FREQ=HOURLY;INTERVAL=1`），最小间隔默认为 15 分钟
- **可暂停、编辑和删除** — 任务卡片支持暂停/启用、编辑 prompt 与频率、删除任务，以及打开对应 DeepSeek 会话
- **运行状态可追踪** — 展示下次运行、上次运行、会话 ID、最近状态和错误信息，失败时可直接在卡片中查看原因
- **复用现有增强能力** — 自动化 prompt 仍会经过 DeepSeek++ 的预设、记忆、`/skill` 和工具调用链路，不需要单独维护第二套 prompt 逻辑
- **DeepSeek 官方网页链路** — 在 DeepSeek 页面同源上下文调用 `/api/v0/chat_session/create`、`/api/v0/chat/completion` 和 `/api/v0/chat/history_messages`，并处理登录 token、PoW challenge、模型类型和父消息 ID 兼容

<p align="center">
  <img src="assets/screenshot-sidepanel-automation.svg" width="300" alt="自动化任务侧边栏">
</p>

#### 自动化运行说明

- 自动化依赖 Chrome 扩展后台定时器；Chrome 关闭或休眠期间错过的触发会在下次唤醒时合并为一次执行，不会补跑多次
- DeepSeek 网页需要保持已登录状态；任务执行时扩展会复用已有 DeepSeek 标签页，找不到时会打开 `https://chat.deepseek.com/`
- cron/RRULE 的最小执行间隔为 15 分钟，避免页面接口、PoW 和账号风控被高频触发
- 自动化 prompt 会走现有 DeepSeek++ 请求拦截链路，因此激活的系统预设、记忆注入、`/skill` 指令和工具调用能力仍然生效
- 运行超时后不会自动重复发送同一条 prompt，避免 DeepSeek 页面仍在执行时产生重复消息
- 从源码更新后需要在 Chrome 扩展管理页重新加载 `dist/chrome-mv3/`，再验证侧边栏「自动化」页

### 工作原理

扩展在 main world 中拦截 `fetch` 和 `XMLHttpRequest`，在请求发送到 DeepSeek API 前修改 prompt（注入预设、记忆、技能指令和工具 schema），并解析 SSE 响应流以提取、隐藏和执行工具调用。

```
用户输入 → 拦截请求 → 注入预设 + 记忆 + 技能指令 + tools schema → DeepSeek API
                                                                    ↓
页面折叠区块 ← 执行结果持久化 ← Content Script 执行工具 ← SSE 流式解析/隐藏工具调用
       ↓
侧边栏 ← IndexedDB/Storage ← 记忆保存/更新/删除
```

工具调用链路分为三层：

1. **Main World**：拦截网络请求和响应流，收集完整回复，识别 XML 工具块，过滤页面可见文本。
2. **Content Script**：接收工具调用，执行记忆增删改，渲染「已执行工具」折叠区块，并恢复刷新后的执行状态。
3. **Background**：统一处理 `SAVE_MEMORY`、`UPDATE_MEMORY`、`DELETE_MEMORY` 等消息，持久化数据并广播状态更新。

## 安装

### 从源码构建

```bash
git clone https://github.com/zhu1090093659/deepseek-pp.git
cd deepseek-pp
npm install
npm run build
```

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择项目下的 `dist/chrome-mv3/` 目录

### 开发模式

```bash
npm run dev    # 启动开发服务器，支持热重载
npm run build  # 生产构建
npm run zip    # 打包为 .zip（用于发布）
npm run compile # TypeScript 类型检查
```

## 技术栈

| 层次 | 技术 |
|------|------|
| 框架 | [WXT](https://wxt.dev) (Chrome MV3) |
| UI | React 19 + Tailwind CSS 4 |
| 存储 | Dexie (IndexedDB) + Chrome Storage API |
| 语言 | TypeScript |

## 项目结构

```
core/
├── constants.ts          # API 地址、token 预算、系统模板
├── types.ts              # 类型定义
├── interceptor/          # 网络拦截（fetch/XHR hook、SSE 解析、工具调用提取/清理）
├── memory/               # 记忆系统（存储、评分筛选、prompt 注入）
├── skill/                # 技能系统（内置技能、解析器、注册表）
├── preset/               # 系统提示词预设（存储、激活管理）
├── automation/           # 自动化任务（存储、调度、DeepSeek runner、桥接协议）
└── ui/                   # 技能自动补全弹窗

entrypoints/
├── background.ts         # Service Worker（消息路由、数据持久化）
├── content.ts            # Content Script（DOM 集成、工具执行、结果区块恢复）
├── main-world.content.ts # Main World 脚本（网络拦截、工具调用桥接）
└── sidepanel/            # 侧边栏 React 应用（记忆/技能/预设/自动化/设置页面）
```

## 友情链接

- [Awesome-Prompts 角色扮演](https://github.com/dongshuyan/Awesome-Prompts/tree/master/%E8%A7%92%E8%89%B2%E6%89%AE%E6%BC%94) — 精选角色扮演 Prompt 合集
- [LINUX DO](https://linux.do) — 新一代开源技术社区

## License

MIT
