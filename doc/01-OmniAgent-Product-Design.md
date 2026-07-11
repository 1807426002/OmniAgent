# OmniAgent 产品设计

## 产品定位

OmniAgent 是一个跨 AI 平台的个人 Agent 系统。

目标：

让 ChatGPT、DeepSeek、Kimi、豆包、千问等网页版 AI 共享：

-   长期记忆
-   Skill
-   Tool
-   MCP
-   Browser Agent
-   Project Context

AI 平台只是入口，用户能力属于 OmniAgent。

## 核心价值

1.  一个记忆系统，服务所有 AI。
2.  一套 Skill，在所有 AI 中复用。
3.  一套工具体系，连接浏览器和外部能力。
4.  一个 Agent Runtime，执行复杂任务。

## 产品形态

浏览器扩展：

-   SidePanel
-   Content Script
-   Background Service Worker

未来：

-   Desktop Agent
-   Mobile Agent
-   Cloud Sync

## 用户场景

### AI 助手增强

用户打开任意 AI 网站，自动获得个人偏好和历史经验。

### 自动执行任务

用户提出目标：

研究项目、分析网页、整理资料。

Agent 自动：

规划 → 执行 → 调用工具 → 输出结果。

### Skill 工作流

用户安装 Skill：

-   视频脚本生成
-   GitHub 分析
-   代码审查
-   内容创作
