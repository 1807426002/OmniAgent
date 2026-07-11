# OmniAgent Skill 规范

## Skill定位

Skill 是可复用的 Agent 工作能力。

组成：

    skill

    ├── SKILL.md
    ├── manifest.json
    ├── references
    ├── scripts
    └── assets

## Skill能力

包含：

-   Prompt
-   Workflow
-   Knowledge
-   Tools
-   Permissions
-   Memory Rules

## manifest 示例

``` json
{
"name":"research-agent",
"tools":[
"browser.search",
"github.search"
]
}
```

## Skill生命周期

安装

↓

加载

↓

读取资源

↓

执行流程

↓

保存经验
