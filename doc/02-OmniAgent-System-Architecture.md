# OmniAgent 系统架构设计

## 总体架构

                        OmniAgent

                     Agent Runtime

    ------------------------------------------------

    Memory     Skills     Tools     Projects

    ------------------------------------------------

                  Provider Layer

    ------------------------------------------------

    ChatGPT  DeepSeek  Kimi  豆包  千问

## 分层设计

## Extension Layer

负责：

-   Vue3 UI
-   SidePanel
-   Content Script
-   Background

## Agent Core

负责：

-   任务执行
-   上下文构建
-   Tool 调度
-   状态管理

## Capability Layer

包括：

-   Memory Engine
-   Skill Engine
-   Tool Runtime
-   Browser Agent
-   MCP

## Provider Layer

AI 网站适配层。

禁止 Core 直接依赖：

-   DeepSeek
-   ChatGPT
-   Kimi

所有差异进入 Adapter。

## 设计原则

1.  Core 与 AI 平台无关。
2.  用户数据优先本地。
3.  所有能力工具化。
4.  平台差异 Adapter 化。
