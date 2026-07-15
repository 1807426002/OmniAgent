# OmniAgent 后续开发计划

## 一、项目定位

OmniAgent 的定位是：

> **网页 AI 的跨平台能力补全层。**

用户仍然在 DeepSeek、Kimi 等网页原生聊天框中使用大模型。

网页 AI 负责：

- 理解用户请求
- 推理
- 使用自身已有能力
- 搜索网页
- 打开链接
- 阅读页面
- 总结内容
- 生成最终回答

OmniAgent 负责补充网页 AI 缺少的能力：

- 跨平台长期记忆
- 用户自己的 Skill
- Project 项目上下文
- MCP 外部工具
- 本地工具
- Browser Control 浏览器操作
- 长任务状态
- 跨 Provider 任务恢复

核心模式不要求用户填写：

```text
BaseURL
API Key
Model
```

外部模型 API 后续可以作为可选能力，但不能成为 OmniAgent 的核心依赖。

---

# 二、核心开发原则

1. 普通聊天继续使用网页 AI 原生聊天框。
2. 不重复开发网页 AI 已经具备的搜索、网页读取和总结能力。
3. OmniAgent 只补充平台缺少的能力。
4. Memory、Skill、Project 和 Tool 必须与具体 AI 平台解耦。
5. Agent Task 只用于复杂、长时间、多工具任务。
6. 普通聊天不默认创建 Agent Task。
7. 当前正则 Planner 只作为测试或兜底，不再继续扩大。
8. 所有外部工具统一进入 Tool Runtime。
9. Browser Agent 改为 Browser Control，只负责真正操作网页。
10. 先完成核心闭环，再继续扩充 SidePanel UI。

---

# 三、阶段一：清理当前演示内容

## 目标

解决首次启动后直接显示：

```text
3 个 Skill
11 个 Tool
```

造成的误导。

## 3.1 Skill 不再自动安装

当前自动写入的三个内置 Skill：

```text
concise-reply
research-agent
code-review
```

调整为：

- 保留为 Skill 模板；
- 首次启动不自动安装；
- 用户点击“安装”后才写入已安装 Skill；
- 模板和已安装 Skill 分开显示。

## 3.2 删除生产环境 Demo MCP

生产环境不再默认注册：

```text
mcp.echo.echo
mcp.notes.notes.write
mcp.notes.notes.read
mcp.notes.notes.list
```

这些只在开发模式或测试模式启用。

## 3.3 Tool 分类加载

首次启动只注册：

```text
memory.search
memory.save
```

开启 Browser Control 后再注册：

```text
browser.snapshot
browser.click
browser.type
browser.scroll
browser.navigate
```

用户添加 MCP 后再注册：

```text
mcp.*
```

## 验收标准

全新安装后：

```text
Skill：0
Tool：2
MCP：0
```

Skill 页面区分：

```text
已安装 Skill
Skill 模板
```

---

# 四、阶段二：完成跨平台 Memory 闭环

## 目标

先把 OmniAgent 最核心的价值做稳定：

> 在 DeepSeek 保存的信息，切换到 Kimi 后仍然可以使用。

## 4.1 完善记忆管理

支持：

```text
新增
编辑
删除
置顶
搜索
类型
作用域
项目绑定
```

## 4.2 记忆作用域

支持：

```text
Global
Provider
Project
```

## 4.3 明确记忆提取

第一版只识别明确表达：

```text
请记住……
以后都……
我喜欢……
我不喜欢……
我的习惯是……
这个项目要求……
```

## 4.4 保存策略

提供三种模式：

```text
自动保存
保存前确认
关闭自动记忆
```

## 4.5 注入诊断

SidePanel 显示：

```text
本次匹配了几条记忆
注入了哪些记忆
为什么匹配
注入到了哪个平台
```

## 验收场景

在 DeepSeek 输入：

```text
请记住：我不喜欢“不是……而是……”这种句式。
```

切换到 Kimi 后输入：

```text
帮我修改这段文案。
```

Kimi 应自动遵守该偏好。

---

# 五、阶段三：重做 Skill 使用流程

## 目标

Skill 不再是启动时自动出现的演示数据，而是用户主动安装、管理并跨平台复用的能力包。

## 5.1 Skill 模板库

提供模板，但不自动安装：

```text
简洁回复
代码审查
调研助手
短视频脚本
```

## 5.2 Skill 安装流程

```text
查看模板
预览内容
点击安装
启用
停用
删除
```

## 5.3 Skill 结构

```text
name
description
triggers
instructions
workflow
knowledge
tools
permissions
source
enabled
```

## 5.4 Skill 匹配日志

显示：

```text
用户请求
候选 Skill
每个 Skill 的匹配得分
最终注入的 Skill
```

## 5.5 手动控制

支持：

```text
本次强制使用某个 Skill
本次禁用全部 Skill
```

## 验收场景

安装“短视频脚本 Skill”后：

```text
DeepSeek 可以使用
Kimi 可以使用
关闭后立即停止生效
删除后不再匹配
```

---

# 六、阶段四：建立 Provider 能力识别

## 目标

避免重复实现网页 AI 已经具备的能力。

## 能力模型

```ts
interface ProviderCapabilities {
  nativeWebSearch: boolean;
  nativeUrlRead: boolean;
  nativeFileAnalysis: boolean;
  nativeImageAnalysis: boolean;
  nativeToolLoop: boolean;
  browserDomControl: boolean;
}
```

## DeepSeek 第一版能力

根据实际验证配置：

```text
网页搜索
URL 读取
网页总结
文件理解
原生工具循环
```

## 注入规则

当平台已有：

```text
nativeWebSearch
nativeUrlRead
```

OmniAgent 不再重复注入：

```text
web.search
web.fetch
普通网页阅读工具
```

只注入平台缺少的能力：

```text
memory.*
用户 Skill
MCP
本地工具
Browser Control
```

## 验收标准

用户要求：

```text
总结一个 GitHub 地址
```

DeepSeek 继续使用自己的原生能力。

OmniAgent 不插入 Browser Control 流程。

---

# 七、阶段五：做最小 Tool Loop

## 目标

网页 AI 只有在需要 OmniAgent 独有能力时，才调用 OmniAgent Tool。

第一版只支持：

```text
memory.search
memory.save
```

## Tool Call 协议

模型输出：

```xml
<omniagent-tool-call>
{
  "name": "memory.save",
  "arguments": {
    "content": "用户喜欢简洁回复",
    "type": "preference"
  }
}
</omniagent-tool-call>
```

OmniAgent 执行后回传：

```xml
<omniagent-tool-result>
{
  "name": "memory.save",
  "ok": true,
  "result": {
    "saved": true
  }
}
</omniagent-tool-result>
```

网页 AI 再继续完成回答。

## 开发模块

```text
Tool Call Parser
Tool Call Validator
Tool Executor
Tool Result Serializer
Continuation Sender
Loop Stop Condition
```

## 验收场景

用户输入：

```text
总结这个 GitHub 项目，并帮我记住主要功能。
```

执行过程：

```text
DeepSeek 使用原生能力总结 GitHub
↓
DeepSeek 调用 memory.save
↓
OmniAgent 保存
↓
结果回传 DeepSeek
↓
DeepSeek 告知用户已经保存
```

---

# 八、阶段六：把 Browser Agent 改成 Browser Control

## 目标

Browser Control 只负责真正操作网页，不负责普通网页搜索和阅读。

## 应该处理

```text
点击按钮
填写表单
选择菜单
上传文件
提交内容
操作后台系统
切换标签页
```

## 不应该接管

```text
搜索新闻
打开 GitHub README
总结普通网页
读取公开页面
```

## 第一版工具

```text
browser.snapshot
browser.click
browser.type
browser.scroll
browser.navigate
browser.wait
```

## 第二版工具

```text
browser.hover
browser.press
browser.upload
browser.dialog
browser.tab.list
browser.tab.open
browser.tab.switch
browser.tab.close
```

## 安全边界

用户必须：

```text
主动开启 Browser Control
选择受控标签页
```

高风险操作必须确认：

```text
发送
发布
删除
提交
购买
修改账号
```

## 验收场景

```text
打开指定后台
点击创建
填写标题和内容
停在提交按钮前等待用户确认
```

---

# 九、阶段七：接入标准 MCP

## 目标

让用户可以添加真正的外部工具，而不是继续使用 Echo 和 Notes Demo。

## 第一版

支持：

```text
Streamable HTTP
initialize
tools/list
tools/call
```

## 第二版

支持：

```text
stdio Native Host
resources
prompts
session lifecycle
```

## 管理功能

```text
添加 MCP
测试连接
刷新工具
启用
停用
按工具授权
删除配置
```

## 原则

所有 MCP Tool 都必须进入：

```text
Tool Runtime
```

不能绕过权限、日志和执行记录。

---

# 十、阶段八：最后再做 Agent Task

## 目标

Agent Task 只用于复杂、长时间、多工具任务，不覆盖所有普通聊天。

## 普通聊天

以下任务不创建 Agent Task：

```text
总结网页
写文案
解释代码
回答问题
普通调研
```

## Agent Task

以下任务才创建：

```text
连续操作多个网页
连续调用多个外部工具
需要暂停恢复
需要失败重试
需要跨页面执行
需要自动化
需要跨 Provider 继续
```

## 第一版入口

不要自动判断。

在 SidePanel 提供明确按钮：

```text
启动 Agent 任务
```

用户主动启动后才创建 Task。

## Task 字段

```text
id
goal
status
providerId
conversationId
projectId
steps
toolResults
createdAt
updatedAt
```

## 状态

```text
idle
running
waiting_model
waiting_tool
waiting_user
stopped
completed
failed
```

---

# 十一、阶段九：跨 Provider 继续任务

## 目标

实现 OmniAgent 区别于单平台扩展的核心能力：

> 同一个任务可以从 DeepSeek 切换到 Kimi 继续。

## 流程

```text
DeepSeek 完成 Step 1～3
↓
用户切换到 Kimi
↓
OmniAgent 注入：
- 原始目标
- 已完成步骤
- 工具结果
- 当前项目
- 相关记忆
- 已选择 Skill
↓
Kimi 从下一步继续
```

## 验收标准

切换平台后：

- 不重新执行成功步骤；
- Task ID 不变；
- 历史步骤不丢失；
- 新 Provider 能理解当前进度。

---

# 十二、阶段十：稳定性和发布

## CI

每次提交自动执行：

```bash
pnpm install
pnpm typecheck:all
pnpm test
pnpm build
```

## 自动测试

覆盖：

```text
DeepSeek Prompt 注入
Kimi Prompt 注入
Memory 跨平台召回
Skill 匹配
Tool Call 解析
Tool Result 回传
Browser Control
MCP 调用
Pause / Resume
Provider Switch
```

## Adapter 健康检查

显示：

```text
页面识别是否成功
输入框是否找到
回复监听是否正常
请求注入是否成功
当前网页版本是否可能不兼容
```

## 当前进展（2026-07-15）

阶段十 A 已完成：

- GitHub Actions 自动执行安装、类型检查、测试、生产构建和产物校验；
- 本地可用 `pnpm release:check` 一次执行完整发布门禁；
- 89 项自动测试通过，包含 DeepSeek 写入、Kimi 召回的跨平台 Memory 集成测试；
- 构建校验会检查 MV3 Manifest、DeepSeek/Kimi 内容脚本和关键记忆功能标记；
- 侧边栏显示输入框、发送按钮、消息监听和回复监听的运行时健康状态。

阶段十 B：真实页面 E2E：

1. 固定 Chrome 版本、DeepSeek/Kimi 测试账号和测试数据，加载最新未打包扩展；
2. 分别确认两个站点的页面识别、输入框、发送按钮、消息监听和回复监听健康；
3. 在 DeepSeek 依次验证“记住文本”“记住上文”“记住当前对话”；
4. 分别上传 TXT、DOCX、PDF，验证“记住附件”完成解析、分块、落库和来源记录；
5. 每次写入后立即检查记忆管理页，确认真实存在且安全内容不再逐条要求确认；
6. 验证页面回复显示真实保存结果，禁止只显示“记住了”但没有落库；
7. 切换到 Kimi 新会话，验证以上文本和文档内容可以按作用域召回；
8. 覆盖刷新页面、重启扩展、重复保存、冲突值、空文件、损坏文件和超限文件；
9. 保存每个场景的执行日志、截图和失败原因，形成可重复的 E2E 报告。

阶段十 B 退出条件：

- 两个平台核心场景全部通过；
- 写入结果、数据库记录和跨平台召回三者一致；
- 不存在静默结束、虚假成功或必须逐条确认的回归；
- 失败场景提供可见、可定位、可恢复的错误信息。

阶段十 C：稳定性与兼容性加固：

1. 将请求注入结果、响应监听状态和页面兼容性结论加入 Adapter 健康检查；
2. 为站点 DOM 变化准备多组选择器和明确的降级提示；
3. 验证旧版本 IndexedDB 升级、扩展重启、浏览器重启后的记忆完整性；
4. 检查权限、敏感信息过滤、日志脱敏、附件大小和解析资源上限；
5. 连续运行长会话、批量文档和跨 Provider 切换，检查重复写入、内存占用和响应延迟；
6. 将 E2E 中发现的每个缺陷补成自动回归测试，再重新执行 `pnpm release:check`。

阶段十 C 退出条件：

- 真实页面 E2E 连续三轮通过；
- 数据迁移、异常恢复和安全检查通过；
- CI、89 项以上自动测试、生产构建及产物校验全部通过；
- 没有阻塞发布的高优先级缺陷。

阶段十 D：发布候选与正式发布：

1. 更新扩展版本号，整理变更记录、已知问题、安装说明和回滚说明；
2. 生成 Chrome MV3 发布包、校验摘要和对应的源码版本标记；
3. 安装发布包做一次独立冒烟测试，确认结果与开发构建一致；
4. 发布 RC 版本，小范围观察真实使用中的保存成功率、召回成功率和 Adapter 失败率；
5. 修复 RC 阻塞问题并重复完整发布门禁；
6. 正式发布后保留上一个稳定包，按日复查首周问题并支持快速回滚。

阶段十 D 退出条件：

- 发布包可安装、可升级、可回滚；
- 发布版本与 Git 标签、构建产物和发布说明一致；
- 首轮观察期没有数据丢失、虚假保存或大面积站点不兼容问题。

---

# 十三、实际开发顺序

当前按以下顺序执行：

```text
1. 阶段一至九：功能主链路已完成，后续只处理回归问题
2. 阶段十 A：CI、自动测试、生产构建和产物校验已完成
3. 阶段十 B：真实 DeepSeek/Kimi 页面 E2E
4. 阶段十 C：稳定性、兼容性、迁移和安全加固
5. 阶段十 D：发布候选、正式发布和首周观察
```

---

# 十四、近期三个里程碑

## 里程碑一：干净可用

完成后首次启动：

```text
Skill：0
Tool：2
MCP：0
```

用户能清楚知道哪些是系统能力，哪些是自己安装的能力。

## 里程碑二：跨平台能力成立

完成：

```text
DeepSeek 保存 Memory
Kimi 使用 Memory

安装一个 Skill
DeepSeek 和 Kimi 都能使用
```

## 里程碑三：能力补全闭环

完成：

```text
网页 AI 使用原生搜索和网页读取
需要 OmniAgent 能力时调用 Tool
执行结果回传原网页会话
网页 AI 继续回答
```

---

# 十五、当前暂时不要继续做

暂停开发：

```text
更多首页统计卡片
更多 Agent 目标预设
继续增加演示 Skill
继续增加演示 Tool
扩大正则 Planner
重复开发 web_search
重复开发 web_fetch
默认让所有聊天进入 Agent Task
```

---

# 十六、当前最近一步

当前第一步是阶段十 B：

> **使用最新 Chrome MV3 构建，在真实登录态 DeepSeek 和 Kimi 页面执行完整记忆 E2E。**

第一轮按以下顺序执行：

```text
加载未打包扩展并检查 Adapter 健康状态
↓
DeepSeek 记住一条文本并核对真实落库
↓
DeepSeek 记住上文并核对可见保存结果
↓
DeepSeek 记住 TXT、DOCX、PDF 附件
↓
切换到 Kimi 新会话
↓
验证文本、上文和附件内容均可召回
↓
刷新页面和重启扩展后重复关键场景
```

第一轮完成后，先修复发现的问题并补自动回归测试，再进入阶段十 C；不得跳过真实页面验收直接制作发布包。
