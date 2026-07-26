<div align="center">

<img src="resources/icon.png" alt="Moli Logo" width="120" />

# 🌸 Moli（茉莉）

### AI 虚拟伴侣桌面应用 —— 茉莉花开，模拟恋人的温度
### AI Virtual Companion Desktop App — Jasmine blooms, the warmth of a simulated lover

[![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&style=flat-square)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&style=flat-square)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript&style=flat-square)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/Version-1.7.0-blue?style=flat-square)](https://github.com/ya-chang/Moli/releases)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&style=flat-square)](https://nilian.ysf.pw)

[官网 Website](https://nilian.ysf.pw) · [下载 Download](https://nilian.ysf.pw) · [使用指南 Guide](https://nilian.ysf.pw)

[English](#english) | [中文](#中文)

</div>

---

<a name="english"></a>
## 📖 About

**Moli (Jasmine)** is an Electron-based AI virtual companion desktop app with a WeChat PC-style UI. The name "Moli" is a homophone for "Simulated Lover" (模拟恋人) in Chinese, and also the name of the jasmine flower. All data is stored locally, supporting multiple character switching, with a complete memory system, emotion model, and learning capabilities.

> 🎯 **Core Value**: An AI companion with memory, emotions, and proactive care. Not just a chatbot — a virtual lover that remembers what you've said, gets angry and makes up, and takes the initiative to care about you.

### ✨ Features

#### 🧠 Memory System (3 Tiers)

| Tier | Description |
|------|-------------|
| 🟢 Short-term | Current conversation context, auto sliding window |
| 🔵 Long-term | Keyword retrieval + vector matching, cross-session recall |
| 🟣 Memory Grading | Auto-evaluate memory importance, prioritize key info |
| 🟡 Summarization | Async conversation summaries injected into System Prompt |

#### 💗 10-Dimensional Emotion Model

| Dimension | Description |
|-----------|-------------|
| 😊 Happiness | Positive emotion, affects reply tone |
| 😢 Sadness | Negative emotion, triggers comfort behavior |
| 😠 Anger | Anger level — can get angry and make up |
| 😰 Anxiety | Unease, affects proactive message frequency |
| 💕 Affection | Liking toward the user |
| 🔥 Intimacy | Closeness of relationship |
| 🤝 Trust | Trust level toward the user |
| ⚡ Energy | Activity level, affects reply length |
| 💭 Longing | Missing level, triggers proactive messages |
| 🧘 Patience | Tolerance, affects conflict handling |

#### 🔧 Core Capabilities

| Feature | Description |
|---------|-------------|
| 🤖 **Multi-Character** | Create multiple AI personas: Tsundere GF / Gentle Sister / Funny Sidekick |
| 📡 **Streaming** | SSE streaming chat, simulates real human typing rhythm |
| 🎭 **Emotion FSM** | 10-dimension real-time emotion changes |
| 📖 **Learning** | RuleEngine (real-time) + ModelAnalyzer (periodic) |
| 🎯 **Intent Classifier** | Auto-detect user intent |
| ⏰ **Proactive Messages** | Good morning/night, miss-you reminders, 50+ holiday awareness |
| 🎵 **Music Awareness** | Built-in NetEase Cloud Music, AI detects your listening status |
| 🎤 **TTS** | MiMo TTS: preset voices / voice design / voice cloning |
| 🎁 **Social** | Red packets, stickers, message quoting, auto-generated Moments |
| 🔌 **Plugins** | Community plugin system, PluginSandbox isolation |
| 💾 **Auto Backup** | Daily 3AM backup, keeps last 7 copies |
| 🛡️ **Crash Recovery** | Lock file detection + data integrity check |
| 🌐 **Multi-Provider** | MiMo / DeepSeek / OpenAI / Ollama, unified OpenAI-compatible format |

---

<a name="中文"></a>
## 📖 项目简介

**Moli（茉莉）** 是一款基于 Electron 的 AI 虚拟伴侣桌面应用，模拟微信 PC 端 UI。名字取自「模拟恋人」的谐音，也是茉莉花的名字。所有数据本地存储，支持多角色切换，拥有完整的记忆系统、情感模型和学习能力。

> 🎯 **核心定位**：有记忆、有情绪、越聊越懂你的 AI 恋人。不是简单的 chatbot，而是能记住你说过的话、会生气会和好、会主动关心你的虚拟伴侣。

### ✨ 功能特性

#### 🧠 记忆系统

| 层级 | 说明 |
|------|------|
| 🟢 短期记忆 | 当前对话上下文，自动滑动窗口管理 |
| 🔵 长期记忆 | 关键词检索 + 向量匹配，跨会话回忆 |
| 🟣 记忆评分 | 自动评估记忆重要性，优先保留关键信息 |
| 🟡 对话摘要 | 异步生成摘要，注入 System Prompt |

#### 💗 十维情感模型

| 维度 | 说明 |
|------|------|
| 开心 😊 | 积极情绪，影响回复语气 |
| 悲伤 😢 | 消极情绪，触发安慰行为 |
| 生气 😠 | 愤怒程度，会生气也会和好 |
| 焦虑 😰 | 不安情绪，影响主动消息频率 |
| 好感 💕 | 对用户的喜欢程度 |
| 亲密度 🔥 | 关系亲密程度 |
| 信任 🤝 | 对用户的信任度 |
| 精力 ⚡ | 活跃度，影响回复长度 |
| 思念 💭 | 想念程度，触发主动消息 |
| 耐心 🧘 | 容忍度，影响冲突处理 |

#### 🔧 核心功能

| 功能 | 说明 |
|------|------|
| 🤖 **多角色** | 支持创建多个 AI 角色，傲娇女友 / 温柔姐姐 / 搞笑担当 |
| 📡 **流式输出** | SSE 流式对话，模拟真人打字节奏 |
| 🎭 **情感状态机** | EmotionFSM，10 维情感实时变化 |
| 📖 **学习系统** | RuleEngine（实时规则）+ ModelAnalyzer（周期分析） |
| 🎯 **意图分类** | IntentClassifier，自动识别用户意图 |
| ⏰ **主动消息** | 早安晚安、想你提醒、节假日感知（50+ 节日） |
| 🎵 **音乐感知** | 内嵌网易云音乐，AI 可识别听歌状态 |
| 🎤 **语音合成** | MiMo TTS，精品音色 / 音色设计 / 音色克隆 |
| 🎁 **社交互动** | 红包、表情包、消息引用、朋友圈自动生成 |
| 🔌 **插件系统** | 社区插件，PluginSandbox 安全隔离 |
| 💾 **自动备份** | 每天凌晨 3 点备份，保留最近 7 份 |
| 🛡️ **崩溃恢复** | 锁文件检测 + 数据完整性检查 |
| 🌐 **多 Provider** | MiMo / DeepSeek / OpenAI / Ollama，统一 OpenAI 兼容格式 |

---

## 🚀 Quick Start / 快速开始

### Requirements / 环境要求

- Node.js 18+
- Windows 10+

```bash
# Clone / 克隆仓库
git clone https://github.com/ya-chang/Moli.git
cd nilian

# Install / 安装依赖
npm install

# Dev mode / 开发模式
npm run dev

# Build Windows installer / 打包 Windows
npm run build:win
```

---

## ⚙️ API Configuration / API 配置

```bash
cp .env.example .env
```

```env
DEEPSEEK_API_KEY=sk-xxx
MIMO_API_KEY=sk-xxx
OPENAI_API_KEY=sk-xxx
```

Each character can independently configure API Provider / Model / API Key in the app settings.

---

## 📁 Project Structure / 项目结构

```
ni-lian/
├── src/
│   ├── main/                    # Electron Main Process
│   │   ├── engine/              # Chat Engine, Model Router, Humanizer
│   │   ├── memory/              # Short/Long-term Memory, Summarizer
│   │   ├── knowledge/           # Knowledge Base (5 MD files)
│   │   ├── learning/            # RuleEngine, ModelAnalyzer
│   │   ├── emotion/             # EmotionFSM
│   │   ├── character/           # Character Manager, Templates
│   │   ├── proactive/           # Proactive Message Scheduler
│   │   ├── social/              # Moments Generator
│   │   ├── music/               # NetEase Cloud Music
│   │   ├── tts/                 # MiMo TTS
│   │   ├── plugins/             # Plugin System
│   │   ├── backup/              # Auto Backup + Crash Recovery
│   │   ├── awareness/           # Holiday + Time Awareness
│   │   └── store/               # Data Persistence
│   ├── renderer/                # React Frontend
│   ├── preload/                 # Preload Scripts
│   └── shared/                  # Shared Types & Constants
├── resources/                   # Icons & Assets
└── package.json
```

---

## 🛠️ Tech Stack / 技术栈

| Tech | Purpose |
|------|---------|
| [Electron 33](https://www.electronjs.org/) | Desktop Framework |
| [React 19](https://react.dev/) | UI Framework |
| [TypeScript 5.8](https://www.typescriptlang.org/) | Type Safety |
| [Zustand](https://github.com/pmndrs/zustand) | State Management |
| [electron-vite](https://electron-vite.org/) | Build Tool |
| [electron-builder](https://www.electron.build/) | App Packaging |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | Database |
| [hnswlib-node](https://github.com/yoshoku/hnswlib-node) | Vector Search |

---

## 🔒 Data Security / 数据安全

- All data stored locally (`%APPDATA%/ni-lian/`)
- API Key isolated per character, never hardcoded
- No cloud upload, no server transmission
- Logs exclude user message content

---

## 📄 License / 许可证

MIT

---

<div align="center">

**Moli（茉莉）—— 茉莉花开，模拟恋人的温度**
**Jasmine blooms, the warmth of a simulated lover**

</div>
