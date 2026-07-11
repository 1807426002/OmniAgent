# OmniAgent 数据库设计

存储：

IndexedDB + Dexie

## providers

AI 平台。

字段：

-   id
-   name
-   adapter
-   capabilities

## conversations

AI 会话映射。

字段：

-   id
-   provider_id
-   external_id
-   title
-   project_id

## messages

消息记录。

字段：

-   id
-   conversation_id
-   role
-   content
-   attachments

## memories

长期记忆。

字段：

-   id
-   type
-   scope
-   content
-   summary
-   importance
-   confidence

类型：

-   profile
-   preference
-   project
-   episode
-   procedure
-   knowledge

## projects

项目上下文。

字段：

-   id
-   name
-   description
-   context
-   status

## tasks

Agent任务。

字段：

-   id
-   project_id
-   goal
-   status
-   progress

## task_steps

任务步骤。

字段：

-   id
-   task_id
-   order
-   description
-   status
-   result

## skills

Skill定义。

字段：

-   id
-   name
-   version
-   manifest
-   enabled

## skill_resources

Skill资源文件。

## tools

工具注册。

## tool_runs

工具执行记录。

## mcp_servers

MCP配置。

## browser_sessions

浏览器控制状态。

## artifacts

任务产生的文件和结果。
