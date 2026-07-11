# OmniAgent Agent Runtime 设计

## 核心目标

实现通用 Agent 执行引擎。

不关心：

-   ChatGPT
-   DeepSeek
-   Kimi

只负责：

任务规划和工具执行。

## 执行流程

    用户目标

    ↓

    Task 创建

    ↓

    Context Builder

    ↓

    加载 Memory

    ↓

    加载 Skill

    ↓

    发现 Tools

    ↓

    调用 AI Provider

    ↓

    解析 Tool Call

    ↓

    执行工具

    ↓

    返回结果

    ↓

    继续执行

    ↓

    任务完成

## 核心模块

## Task Manager

管理：

-   创建任务
-   状态
-   暂停
-   恢复

## Context Builder

负责：

-   Memory 检索
-   Skill 加载
-   Project 注入
-   Tool 描述生成

## Tool Executor

负责：

-   权限检查
-   工具执行
-   结果处理

## Agent 状态

-   idle
-   planning
-   running
-   waiting_tool
-   completed
-   failed
-   stopped

## 后续能力

-   并行工具
-   自动重试
-   长任务恢复
-   执行日志
