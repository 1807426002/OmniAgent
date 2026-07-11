# OmniAgent Site Adapter 规范

## 目标

统一接入不同 AI 网页。

## Adapter 接口

``` ts
interface SiteAdapter {

id:string;

match(url:string):boolean;

sendMessage(message:string):Promise<void>;

observeResponse(callback):void;

getConversationId():string|null;

}
```

## 目录

    site-adapters

    chatgpt

    deepseek

    kimi

    doubao

    qianwen

## Adapter职责

负责：

-   页面识别
-   输入框定位
-   消息发送
-   回复监听
-   页面状态判断

禁止：

Adapter 中实现：

-   Memory
-   Skill
-   Agent Runtime
