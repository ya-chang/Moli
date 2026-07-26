# Moli (ni-lian) — 开发规范

## 项目定位

Electron 桌面应用，模拟微信PC端UI的AI虚拟伴侣。本地运行，所有数据在本地。

## 技术栈

```
桌面壳：Electron + electron-vite
前端：React 18 + TypeScript + Zustand
样式：纯CSS（不是Tailwind）
后端：Electron主进程（Node.js）
数据库：SQLite + better-sqlite3
向量：hnswlib-node + 本地embedding
模型：DeepSeek/MiMo/OpenAI/Ollama，统一OpenAI兼容格式
```

## 命令

```bash
npm run dev          # 开发模式（热更新）
npm run build        # 编译
npx electron-builder --win  # 打包Windows安装程序
npx tsx test-knowledge.ts   # 跑测试脚本
```

## 架构

```
src/main/       Electron主进程（后端）
src/renderer/   React前端
src/preload/    预加载脚本（IPC桥接）
src/shared/     前后端共享类型和常量
data/           运行时数据（角色/记忆/知识库）
```

通信方式：前端 ↔ IPC ↔ 主进程。前端不直接访问数据库。

## 关键约定

- **每个角色独立数据**：`data/characters/{id}/` 下有 config.yaml + knowledge/（5个MD文件）
- **MD文件是SQLite的下游产物**：SQLite存原始消息，异步触发模型分析生成MD文件注入Prompt
- **API Key按角色隔离**：每个角色独立的provider/model/apiKey，全局配置不参与
- **消息持久化到文件系统**：`data/messages/{characterId}.json`，不是localStorage
- **知识库5文件**：persona.md（手动改）、user_profile.md、chat_summary.md、style_learning.md、chat_logs.md
- **打包后数据在userData**：`app.isPackaged`时用`app.getPath('userData')`，开发时用`process.cwd()`

## 文件规范

新增文件按模块放对应目录：
- 后端：`src/main/{module}/`
- 前端组件：`src/renderer/components/{module}/`
- 状态管理：`src/renderer/stores/`
- IPC通道：`src/shared/ipc-channels.ts` 追加

已有文件只允许追加，不允许重写已有代码。

## 安全

- API Key不明文写在代码里
- 不实现云端上传
- 日志不输出用户消息内容
- `data/` 目录不入git
