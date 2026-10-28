# dsh-annotation

在 DSH 对话或工作区文件预览里选中文字，写一条批注，回车——批注块随你的消息一起发出，模型逐条按编号回答。

[![DSH](https://img.shields.io/badge/DSH-up%20to%200.2.1--rc.3-4D6BFE)](https://github.com/deepseek-ai/deepseek-harness) [![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE) [![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

![选中文字、写批注、编号角标、待发清单、发送、回复逐条对照的完整交互](https://raw.githubusercontent.com/zuojinxin/dsh-annotation/main/docs/images/demo.gif)

<details>
<summary>静态界面预览</summary>

![选中一段文字，工具条贴在选区上方](https://raw.githubusercontent.com/zuojinxin/dsh-annotation/main/docs/screenshots/01-toolbar.png)

![两条批注的编号角标，输入框旁的「2 条批注」悬停展开清单](https://raw.githubusercontent.com/zuojinxin/dsh-annotation/main/docs/screenshots/02-markers.png)

![回复里的 Annotation 编号变成可悬停芯片，悬停回看原文与批注](https://raw.githubusercontent.com/zuojinxin/dsh-annotation/main/docs/screenshots/03-reply.png)

</details>

> 动图与截图在[匿名示意页](https://github.com/zuojinxin/dsh-annotation/blob/main/docs/preview.html)中**运行真实插件**生成，会话名、工作区名为虚构数据，不含任何真实会话或账号。

## 功能

- **选中即批注**：选中助手正文（或工作区文件预览里的文字），工具条点「批注」写备注；留空也能保存，等于标出位置而不写意见。
- **编号角标**：蓝色编号角标贴着原文，滚动时跟随正文、靠近视口边缘自动避让；悬停角标会点亮原文并显示这条批注。
- **跨回合收集**：可以在任意多条消息、多个回合里持续追加批注，统一从 1 编号。
- **待发标签**：输入框旁出现 `N 条批注`，悬停列出全部待发批注，可逐条删除。
- **回车即发**：批注块与你输入的问题一起发出，模型拿到完整批注块。
- **气泡干净**：发送后用户气泡只留你的问题加标签，批注块在浏览器绘制前就被摘掉；刷新历史也会自愈。
- **逐条对照回复**：消息里带上格式约束，模型按 `Annotation 1: …` 到 `Annotation N: …` 回答，回复里的编号变成可悬停芯片，回看原文与批注。
- **文件批注**：侧边栏文件预览（Markdown、纯文本、代码）走同一套流程，引用带文件路径，角标刷新后恢复，同一句话出现在两个文件里也不会串。

## 交互流

```
选中文字 ──▶ 工具条「批注」──▶ 写备注或留空 ──▶ 高亮 + 编号角标
    ▲                                              │
    └──────── 任意条数，跨回合追加 ◀───────────────┘
                       │
                       ▼
          输入框旁「N 条批注」标签（悬停查看 / 逐条删除）
                       │
                    回车发送
                       ▼
   模型收到：批注块（编号 + 原文 + 批注）+ 你的问题
   你的气泡：只有问题 + 标签，不含批注块原文
   模型回复：Annotation 1: … Annotation 2: …（可悬停芯片）
```

## 安装

```bash
dsh plugin --profile desktop add 'github:zuojinxin/dsh-annotation'
```

装完重启 DSH 桌面版生效。

## 说明

- 面向 DeepSeek Harness 0.2.1-rc.3（桌面版）。插件靠宿主 CSS 类名与 DOM 结构定位，DSH 升级后可能需要适配。
- 支持对话消息正文与工作区文件预览里的文字；PDF、图片、iframe 内的 HTML 不在范围内。
- 选中助手正文时，批注工具条会接管宿主自带的引用浮层，只留一个入口。
- 界面文案与批注协议跟随宿主 `locale`（中文 / 英文，可运行时切换）。
- 待发批注存在浏览器 `localStorage`，换浏览器或清站点数据会丢。
- 禁用插件后，页面上由它添加的元素和样式会全部移除。

## 开发

```bash
npm test                  # jsdom 单元测试
node --check client.js    # 浏览器端是手写文件，不是构建产物
node docs/render-demo.mjs # 重制动图与截图（无头 Edge + ffmpeg）
```

`docs/preview.html` 是录制源：它把 `client.js` 原样注入一个手工搭的宿主外壳，把时间轴暴露成 `window.demoFrame(t)`，录制脚本据此逐帧断言画面状态，而不是只看图觉得对。

浏览器级检查（`test/overlay-browser.mjs`、`test/sidebar-browser.mjs`）需要 Playwright：把 `PLAYWRIGHT_MODULE` 指向已有的 `playwright-core/index.mjs`。

## 许可证

[MIT](./LICENSE) · [English](./README.en.md)
