# OmniAgent Codex 开发指南

## 第一阶段

只搭建基础工程。

技术：

-   Vue3
-   TypeScript
-   WXT
-   Pinia
-   Element Plus
-   TailwindCSS
-   pnpm workspace

## 目录

    apps

    extension


    packages

    agent-core

    memory

    skills

    tools

    browser-agent

    mcp

    storage

    site-adapters

    shared

## 开发规则

1.  不允许 Core 依赖具体 AI 平台。
2.  不复制 DeepSeek 专属逻辑。
3.  所有平台差异进入 Adapter。
4.  所有能力统一 Tool 化。

## 第一阶段交付

完成：

-   Monorepo
-   Vue3 Extension
-   SidePanel
-   Background
-   Content Script
-   Package结构

暂不实现：

-   Agent执行
-   MCP
-   Memory算法
