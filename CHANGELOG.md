# Changelog

## [1.4.27] - 2026-10-04

### 变更
- **回复顺序改为显式约束：先逐条回应批注，再回答提示词相关的问题**（用户 2026-10-04 要求：
  「我希望接收到的内容，批注是在最前面的，也就是先回答批注信息，然后再回答提示词相关问题」）。

  消息结构本来就是批注在前（`buildBlock(...) + '\n' + draft`），但格式指令原文只写
  「…逐条回应上面每一条批注，**最后**再回答我的问题。」——提问很长时模型容易先答提问。
  现在把指令改成显式的顺序约束：

  - zh：`回答顺序：先按「Annotation 1：…」到「Annotation {n}：…」的格式逐条回应上面每一条批注（这部分放在最前面），然后再回答我的问题。`
  - en：`Answer order: first respond to each annotation above in the format "Annotation 1: …" through "Annotation {n}: …" (that part goes first), then answer my question.`

  结构不变（头部 → 批注 → 顺序指令 → 「提问：」→ 用户正文），因此气泡隐藏手术与
  回复里「Annotation N：」→ 悬浮芯片的解析都不受影响；`formatOnly`（纯批注、无提问）
  **不加**顺序指令——没有提问就没有顺序可言。

### 测试
- 新增 `zh/en: 有正文时块序固定为 头部→批注→回答顺序指令→提问标记→用户正文`：
  断言五段的 `indexOf` 严格递增（批注在提示词之前）、顺序指令含「先…然后再回答我的问题」、
  正文一定在提问标记之后。标记用 `lastIndexOf`——原文里也可能出现「提问：」，harness 的
  quote 文本就是故意这么设计的。
- 把「纯批注不含顺序指令」的断言从已删除的旧文案（`最后再回答我的问题`）换成
  `回答顺序|Answer order`，否则那条断言会退化成恒真。
- 全套件 **65/65 全绿**。

## [1.4.26] - 2026-10-04

### 修复
- **批注不再和截图+提示词分成两轮发出**（用户 2026-10-04 报，对照豆包）：用户预期与所有
  参考实现一致——**批注就是提示词的一部分**，必须与截图、正文同处一条消息（豆包「追问：
  在新的消息中引用所选内容」、ChatGPT/Claude 的引用回复都是这个语义：引用是消息里的一个
  content part，不是另一次发送）。

  **根因（从用户本机会话日志钉死，非推测）**：`session-1b490ca2…/session.v4.jsonl.zstd`
  里那次是**两条不同 rpcId 的用户消息**、间隔 193ms；批注那条是 `headOnly` 变体（无
  「提问：」标记），而 `headOnly` 只在 `buildBlock(hasQuestion=false)` 时生成 →
  **插件拼稿那一刻把用户正文读成了空串**。于是批注单独走一条，宿主又把自己那份
  「正文 + attachmentIds」提交成另一条。两处缺陷：

  1. `attachAndSend` 只读 `shell.state.getSnapshot().draft`——输入区的文字还没同步进服务态
     时（附件上传 / React 提交批次延迟）读到空串。现在改为 `resolveDraftText(shell)`：
     **服务态为空就回退读输入区 DOM**，绝不把正文读丢（正文为空才生成 headOnly，那是正确的）。
  2. 发送按钮路径原先是「有附件就不接管」（v1.4.22 的守卫）→ 批注根本不参与这次提交。
     现在按「有没有用户内容」分流：
     - **有用户内容**（草稿非空 或 有附件）→ 只把批注块 prepend 进草稿，然后**放行事件、
       交给宿主提交**。宿主的一次提交会把 draft 与 attachmentIds 装进同一个 payload
       （`sinkSerialized` → `sendSession(text, attachmentIds, …)`），于是「批注 + 截图 +
       提示词」就是同一条消息。这条路径**绝不自己 submit**（那正是分成两轮的来源）。
     - **没有用户内容**（空草稿、无附件）→ 宿主因 empty 会拒绝提交，仍由插件接管按钮自己
       `submit('queue')` 发纯批注（v1.4.21 行为不变）。

  另：新增 `rollbackDraft` 记住拼稿前的原始草稿，宿主同步拒绝提交时还原，不让批注块留在
  输入框里；Enter 路径同样改走 `resolveDraftText`，附件场景不再分叉。

### 测试
- `test/send-button.test.mjs` 扩到覆盖新契约：两条路径分流（有内容只拼稿放行、空草稿才接管）、
  `prependBlockForHostSubmit` 不做任何提交、`resolveDraftText` 的「服务态空 → 回退 DOM」
  根因场景与抛错兜底、拼稿后草稿同时含批注块与正文。
- `test/message-block.test.mjs` harness 补 `resolveDraftText` / `domDraftText` / `rollbackDraft`
  桩（缺桩会被 `attachAndSend` 的 try/catch 吞掉，表现为返回 false）。
- 全套件 **63/63 全绿**。

## [1.4.25] - 2026-10-04

### 修复
- **点编号角标改批注时，编辑卡片不再跑到屏幕另一头**（用户 2026-10-04 报）：旧实现只把
  **原文**的位置交给卡片（`locateQuote(q.text)` → 贴原文下方居中），用户点在哪颗角标上
  完全不参与落位。同一段文字在文档里出现多次时（例如本仓库 README 里的 REFUSAL
  HARDENING 段落出现两次），`locateQuote` 可能命中另一处 → 卡片出现在远处，用户点完还
  得把鼠标移过去。

  现在角标点击把「**它对应的那段原文的矩形**」+「被点到的那颗角标」一起交给
  `openEditorFor`（**不再** `locateQuote`——那正是命中另一处的来源）：
  1. 落位基准 = 原文矩形，规则 = 新增的 `placeEditorNear()`，而它就是对 `placeForSelection`
     的一层封装 —— 与**首次划选弹出的工具条**是同一条规则（居中于基准、落在基准下方
     8px、下方确实放不下才翻到上方），因此「首次框选」与「二次点角标编辑」的卡片出现在
     **同一相对位置**（用户明确要求两次一致）；首帧同样用估算宽度，挂载后按实测宽度重排；
  2. 首次划选进编辑时卡片**原地接替工具条**：`ui.enterSync` 在首次渲染里同步写一次位置
     （只消费一次），否则卡片会先以 (0,0) 绘一帧、紧接着的 rAF 重排把它挪过去，用户看到
     的是「一张滑过去的卡片」而不是原地出现；
  3. 卡片打开期间锚定该角标（`ui.editorAnchorNode` + `ui.editorAnchorRel` 记住「原文相对
     角标」的偏移）：滚动 / 视口尺寸变化时按角标的新位置反推原文矩形再落位，卡片始终待在
     原文旁边；角标随消息滚出视口则保持原位，绝不甩到屏幕角落；
  4. 标记层整层重建会让旧角标脱离文档，此时按 `data-ann-chip-for="<批注 id>"` 在标记层里
     重新认领新角标（不查 `document`，保持函数在无 document 的单测环境里也不抛）；
  5. 用户手动拖动卡片 = 明确要自己摆位置 → 解除锚定，之后滚动不再把它拽回去。
  「编辑」铅笔按钮路径拿不到原文矩形，仍走 `locateQuote` + 贴原文下方（行为不变）。

- **二次编辑卡片右上角改为垃圾桶（删除此批注）**（用户 2026-10-04 报）：原先头部右上角的
  「X」与底部「取消」功能完全一样，用户想删掉这条批注只能去输入框左上角的批注胶囊里删。
  现在二次编辑时头部换成垃圾桶图标（hover 用错误色区分语义），点击走与胶囊面板同一条
  `removeQuote` 路径并 toast 确认（「已删除该批注」/「Annotation deleted」）；**新增批注**
  时此时还没有可删的批注，仍显示关闭按钮。

### 变更
- **「保存批注」→「保存」**（en: `Save annotation` → `Save`）：四个字过长（用户要求）。

### 测试
- 新增 `test/editor-placement.test.mjs`（16 条）：`placeEditorNear` 与 `placeForSelection`
  同源（含「首次划选 = 二次编辑」同位置的断言）+ 翻侧 / 视口夹取 / 估算尺寸；角标点击把
  原文矩形与角标一起交给编辑器（不再重新定位原文）；`openEditorFor` 的锚点与偏移记录；
  `enterSync` 的一次性消费；`followEditorAnchor` 按偏移跟随 + 滚出视口保持原位；拖动解除
  锚定；`closeToolbar` 清锚点；头部垃圾桶（二次编辑）/ 关闭（新增）分支、`deleteEditing`
  真的走 `removeQuote`、文案缩短与两语提示、danger hover 样式。
- 全套件 **60/60 全绿**。

## [1.4.24] - 2026-09-30

### 修复
- **点发送的瞬间不再看到批注原文一闪而过**（用户 2026-09-30 报；v1.4.23 未修复）：真因在宿主侧——
  宿主的**提交回显气泡** `PendingSubmissionBubble`（`dsh-client-ui-chat`，元素带
  `[data-submission-echo]`）从点击发送那一刻就把草稿原文显示出来，其注释写明
  「visible from the submit click until the durable `user/message` or steering occurrence
  renders」；而 `ChatNodeList` 把 pendingRows **直接追加在列表末尾、没有 ChatNodeSeat 包装**，
  所以它拿不到 `data-chat-flow-kind` → 插件的 `allMessageRows()` 永远看不到它，从来没管过这个
  元素。v1.4.23 的「期待新气泡」窗口打的是别处，所以照旧闪。

  现在：
  1. `hideDockEchoBlocks()` 用与普通气泡**同一条路径**处理 `[data-submission-echo]`：反解析条目
     → 隐藏块 → 贴「批注 ×N」，所以从点击那一刻看到的就是标签。关键是让 `hideAnnotationBlock`
     自己落到 `[class*="bubble"]` 上——把整个 `userRow` 当容器时，行里的时间戳（如「03:31」）
     会让「纯批注」的严格判定失败（本版初版就是这么错的，用户实测仍闪）。
  2. 纯批注的判定不再要求「整段文本恰好等于块本身」：定位 `headOnly…formatOnly` 区间并用
     `cutRange` 跨文本节点切掉，保留容器里其它文本（时间戳 / 操作按钮 / 回显状态字）。
  3. 窗口不再「第一次隐藏成功就收窗」（v1.4.23 的错），改为按时间过期 + O(1) 的
     `freshBubbleNeedsHide()` 决定要不要全量扫描。

### 验证方式
本轮**不是**靠单元测试下的结论：先装了一个带帧级自检的 verify 构建（用 rAF 在绘制前采样
「批注块是否进入即将绘制的帧」，把结果 toast 出来），由用户在真实应用里复现并确认——
「现在修复了，看不到一闪而过的原文」。自检代码已从正式版删除，并有测试锁住它不再出现。

### 测试
- `test/bubble-hide.test.mjs`：新增回显行处理顺序（反解析 → 隐藏 → 贴标签）、隐藏失败不贴标签、
  纯批注判定不许退回 `endsWith` 写法、以及「自检已拆干净」。
- `test/message-block.test.mjs` harness 补 `cutRange` / `pruneEmpty` 桩。
- 全套件 **45/45 全绿**。

## [1.4.23] - 2026-09-30

### 修复
- **点发送的瞬间不再看到批注原文一闪而过**（用户 2026-09-30 报）：隐藏手术
  （`decorateAll` → `hideAnnotationBlock`）原先只在**含 `childList` 的批次**里同步执行——这是
  v1.4.3 为省流式开销做的优化，前提假设是「行插入批次本身就携带完整批注块」。但用户消息气泡
  可能先插入空行、再由 React 的 `commitTextUpdate` 把文本写进**已有的**文本节点，那是
  `characterData` 批次；这种批次原先只触发 500ms 限流的助手芯片扫描，于是批注块先被画了出来
  （用户看到原文一闪而过），要等 1s 兜底轮询才被隐藏。

  现在发送时打开一个「期待新气泡」窗口（`markFreshBubble()`，≤2s）：窗口内**任何**相关批次都
  同步跑一次隐藏手术；最新一条装饰成功后立刻收起窗口（`settleFreshBubble()`），所以不会把
  v1.4.3 省下的流式开销还回去。窗口在两个拼稿路径（服务 / DOM 回退）与草稿提交
  （`clearSentQuotes`）三处打开，覆盖「订阅缺失但气泡照样出现」的情况。

### 测试
- 新增 `test/bubble-hide.test.mjs`：锁住窗口语义（标记 / 过期 / 收起）、observer 的
  `hasRowInsert || awaitingFreshBubble()` 条件、`decorateAll` 只在最新一条装饰成功后收起、
  以及三个打开点。
- `test/message-block.test.mjs` 的 harness 补上 `markFreshBubble` 桩（`attachAndSend` 的新
  自由变量；缺桩会被它的 try/catch 吞掉，表现为 `attachAndSend` 返回 false）。
- 全套件 **39/39 全绿**。

## [1.4.22] - 2026-09-30

### 加固（v1.4.21 的审计结论）

v1.4.21 让「有批注 + 草稿为空」时可以直接点发送，做法是摘掉宿主发送按钮的 `disabled`
并接管 `click`。审计「这是否绕过了宿主的守卫」时查出两个窄口子，本版补上：

- **有附件时不再接管**：宿主禁用的四个原因里，`empty` 的定义是
  `draft.trim() === '' && attachments.length === 0`——所以「有附件 + 草稿文本为空 + 按钮被
  禁用」只可能是 `uploadsPending`（附件还在上传）。此前会接管，等于绕过宿主的这道守卫；
  现在直接让开，由宿主自己的错误通知（`file.stillUploading`）说明原因。判定用附件条的
  group `aria-label`（`attachment.pending`，rail 只在有附件时渲染），不依赖哈希类名。
- **提交途中不再重新接管**：宿主靠 `primaryDisabled` 里的 `machineBusy` 防止「提交途中再
  提交」，我们摘掉了 `disabled` 就必须自己补这道闸——否则双击的第二下会在提交途中再喂一次
  `enter`（宿主的 `submit(mode)` 不幂等，`mode="queue"` 会把第二条排进队列）。现在从提交那
  一刻起上闸，直到 pending 批注被消费（或用户重新输入、或兜底 5s 超时）才解锁。
- **还原 `disabled` 时要求按钮仍是「普通发送」按钮**：运行中它会变成停止按钮，此前在极端
  时序下可能把 `disabled` 设回去，导致「停止」点不了。现在 `syncSendButton` 与
  `releaseSendButton` 都先确认按钮仍是普通发送按钮、且草稿仍为空才还原。

另外把「宿主同步抛错」与「宿主异步失败」的区别写清楚：`shell.submit()` 本身不抛
（它只是往输入机喂一个 `enter` 事件），附件未上传完之类的失败发生在下潜的
`sendSession` / `serializeDraftAttachments` 里，经 `notify("error", …)` 由宿主自己呈现；
插件的 toast 只兜同步抛出的情况，不再重复提示。

### 测试
- `test/send-button.test.mjs` 扩到覆盖三道守卫（附件 / 在途闸 / 还原条件）与
  `isPlainSendButton`、`hasAttachments`、`sendStillInFlight` 的独立行为。
- 全套件 **34/34 全绿**。

## [1.4.21] - 2026-09-30

### 修复
- **有批注但输入框为空时，发送按钮可以直接点**：宿主 InputBar 的发送按钮在草稿为空时是
  `disabled` 的（`primaryDisabled = empty || disabled || machineBusy || uploadsPending`，其中
  `empty = draft.trim() === '' && attachments.length === 0`），而浏览器**不会给 `disabled`
  的表单控件派发 pointer/mouse 事件**——所以此前「监听按钮上的 pointerdown」的实现永远等不到
  事件（注释里「pointerdown 能覆盖禁用的发送按钮」的假设是错的）。表现是：批注写好之后必须先
  随便往输入框打点字，才能点发送。现在改为：有批注待发送且草稿为空时主动摘掉按钮的
  `disabled`（视觉与功能一致地变为可用），并在 capture 阶段接管 `click`，走插件自己的纯批注
  提交路径（与 Cmd/Ctrl+Enter 同一条路径）。草稿非空、按钮变成停止/排队/插话、输入区
  `aria-disabled`、或无待发送批注时立即把 `disabled` 还回去，且不会覆盖用户已输入文字后宿主
  自己恢复的可用状态；卸载时释放按钮并断开观察器，不留「看起来可用、点了没反应」的按钮。
  宿主拒绝提交（附件还在上传等）时用 toast 如实告知，不假装成功。

### 测试
- 新增 `test/send-button.test.mjs`，锁住接管策略（capture 阶段、标记属性、只按草稿状态还原）
  与决策守卫（批注数 / 按钮 label / 草稿空判定 / `aria-disabled`）。
- 同时把 4 个上游测试对齐本地实现——v1.4.12–v1.4.20 期间它们已经与实现脱节，`npm test`
  长期是红的（本次修复前 8 条失败）：
  `enter-policy` 移除断言旧 `onSendPointerDown` 实现的用例（它把那个 bug 锁死了）；
  `layout-overlay` 的 `placeAbove` 改为 v1.4.17 起的三参数签名（实测宽度）；
  `message-block` 的 harness 补上 `currentSessionId` / `scopeOfSession` / `shellFor` 桩；
  `pending-clear` 的会话切换检测改为本地版本的轮询实现。现在 31/31 全绿。

## [1.4.20] - 2026-09-30

本仓库为 `zuojinxin` 的本地维护 fork，上游 `omdsh-dev/dsh-annotation` 停在
`1.4.11-preview.1`（2026-09-15）。以下 v1.4.12–v1.4.20 是本地修复序列，全部集中在
`client.js`（自包含浏览器包，非构建产物）：

- **v1.4.12** 工具条定位改为「划选结束时鼠标停留位置的正下方」（pointer 落点追踪；键盘 /
  双击划选回退选区矩形定位），不再居中于整个选区、不再压住选区下方正文。
- **v1.4.13** 修复「同时出现两个批注按钮」（teardown 单槽引用被覆盖 → 旧浮层残留；改为实例
  注册表逐个撤销 + 选择器清场兜底）与「按钮四周一圈透明灰色光晕」（浮层不再用半透明菜单填充
  + 40px 背景模糊 + 全透明描边；改插件自有的不透明表面变量 + 轻投影 + 实体细描边，不依赖会被
  皮肤覆盖的主题 token）。
- **v1.4.14** 残留清场的两个触发点补齐：`decorateAll` 周期清场（兜住启动后新塞入的残留层）
  + teardown 清场。
- **v1.4.15** teardown 清场加「当前实例」守卫：旧实例被延迟 dispose 时不再误删新实例的浮层。
- **v1.4.16** 修复「有时候工具条不在鼠标下方」：拖动越出视口时不再丢弃指针锚点（钳到最近
  边缘），真实拖动一经确认即置可信（不依赖 pointerup，窗口外松开也能贴鼠标），并补
  `pointercancel` 收尾。
- **v1.4.17** 修复「反向划选时工具条不紧贴鼠标」：旧实现固定取 `Math.max(point.y,
  rect.bottom)`，反向划选时光标在选区上沿，必然取到 `rect.bottom`，工具条被推到整个选区
  之外。改为按「光标在选区哪一半」决定贴光标上方还是下方；`placeAbove` 同时改用实测宽度
  （原硬编码 400 会把窄选区推到视口最左边）。
- **v1.4.18** 定位优先级收敛为「紧贴光标 → 让开选区 → 翻侧 → 视口夹取」，修好光标落在选区
  内部空档行时「贴光标」与「不压正文」互相冲突的情况。
- **v1.4.19** 「让开选区」改为候选 + 容差（4px）评估，修好 v1.4.18 因 1px 边缘交叠就把工具条
  推到整个选区之外的问题，恢复「紧贴光标」。
- **v1.4.20** 工具条方向恒定：一律出现在光标下方，不再按划选方向翻上翻下（仅当光标贴近视口
  底部、下方确实放不下时才翻到上方）。

另含本地补强（同属 client.js）：

- 服务惰性解析：`ctx.sessions` / `ctx.conversation` 在 fiber inactive 窗口内重新解析、失败
  回退 DOM 注入，批注不再静默丢失。
- DOM 回退提交路径：服务不可用时向 `[data-composer-input]` 注入批注块并派发合成 Enter，
  由宿主自己的键位表提交。
- 发送完成监听双路：服务订阅（`shell.state.subscribe`）+ DOM 观察（`MutationObserver`），
  两者幂等。

安装（指向本 fork）：

```sh
dsh plugin --profile <profile> add github:zuojinxin/dsh-annotation
```

## [1.4.11-preview.1] - 2026-09-15

- 更新 preview 预发布验收宿主至 DSH 0.1.6-alpha.1；发布任务验证同一安装包后发布至 npm preview。

- 支持 DSH 0.1.5-rc.2 侧边栏文本、Markdown 和代码文件批注，发送时携带来源路径；同文不同文件独立保存，刷新后按文件恢复（#57）。

## [1.4.10] - 2026-09-11

- CI 与发布包验收固定到 DSH 0.1.5-rc.2，继续验证 0.1.2-rc.1 支持下限。
- 复核选区、保存与刷新恢复，以及空正文发送、编辑窗口拖动和高亮避开输入框的已有修复（#49、#50、#52）。

## [1.4.9] - 2026-09-09

### 兼容性
- 正式宿主验证保持 DSH 0.1.2-rc.1，预览宿主验证更新到 0.1.5-alpha.1。

### 交互
- 批注工具条优先出现在选区下方；编辑窗口支持拖动，高亮避开输入区域（#48、#49、#50）。

### 修复
- 输入区为空或只有空白时，发送纯批注，不再追加空的「提问：」或要求模型回答不存在的问题；纯批注仍可隐藏为标签，并支持刷新后解析及中英文切换（#52）。

## [1.4.8] - 2026-09-05
### 兼容性
- 适配 DSH 0.1.2-rc.1 和 0.1.3-alpha.1：保存或编辑批注后聚焦可编辑输入区，并将光标放到草稿末尾，支持继续输入和直接回车发送。
- CI 与发布验收分别固定到上述官方 rc 和 alpha 标签。

## [1.4.7] - 2026-09-04
### 修复
- **设置页不再被批注高亮遮挡（issue #44）**：设置弹窗打开时隐藏会话选区高亮层，避免插件的页面级浮层跨越宿主侧栏层叠环境。
- **重启恢复后批注胶囊继续跟随输入框（issue #44）**：胶囊定位接入已有的滚动、窗口尺寸和页面布局刷新入口，并监听输入框自身尺寸变化；输入框未就绪或移出视口时先隐藏，不再停留在旧坐标。

## [1.4.6] - 2026-09-04
### 修复
- **新版输入区可随 Enter 发送批注（issue #41）**：适配 DSH 0.1.2-alpha.1 的 `div[data-composer-input]` 可编辑输入区，不再因旧 `textarea` 类型守卫跳过批注拼稿；继续保留输入卡片范围、输入法合成、斜杠命令及发送按钮策略。

### 发布
- **正式版与测试版分流**：版本带预发布后缀时必须勾选 GitHub Pre-release，并只进入 npm `next`；无后缀版本只能作为正式 Release 进入 `latest`。新增 `dsh-v0.1.1-rc.2` / `dsh-v0.1.2-alpha.1` 双宿主真实 Web 验收，发布前确认插件资源可访问、页面完成挂载且没有页面异常。

## [1.4.5] - 2026-08-29
### 修复
- **切回会话后待发送批注不再被误清空（issue #28 复测）**：1.4.3 的持久化本身工作正常（切换时正确落盘并恢复），但 `decorateAll` 把「装饰到带批注块的用户气泡」一律当作「批注刚随消息发出」并清空待发送集——会话里只要有一条历史已发送的带批注消息，切回该会话（或刷新）时历史消息以未装饰状态重新渲染、被重装饰，刚恢复的待发送批注就在 1 秒内被误判为已发送而清空落盘数据。现在装饰扫描只负责隐藏批注块/贴标签，绝不清空；发送清空的唯一权威是 `watchInputDraft` 的「草稿有→空」迁移。原先靠装饰清空兜底的「插件先于会话加载完成导致订阅失效」时序洞改为源头修复：订阅失败每秒重试直到挂上。另修复发送暂存数据在隐藏手术成功前被提前弹出（内容未渲染完时丢失，回退为反解析）、会话切换后旧会话未消费的发送暂存数据被新会话历史消息误消费（错贴标签内容）两处次生问题。回归验证：新增 `scripts/smoke-pending-switch.mjs`（真实 client.js 全生命周期：恢复 → 切走 → 切回存活 → 真实发送仍清空，7/7）与 `test/pending-clear.test.mjs`（清空策略结构守卫，4/4）。

## [1.4.4] - 2026-08-28
### 兼容性
- **dsh 0.1.2-alpha.1**：安装自检改为使用新版 Web 一次性令牌入口并检查启动图登记，不再请求已移除的单插件裸地址。插件运行代码和宿主配置契约无需兼容层，也未修改 dsh 本体；官方标签源码构建在 Node 24.13 下完成 macOS 真机页面激活，批注插件启动图登记、页面挂载和零页面异常均已确认。Node 24.11 会令该宿主启动图为空，本机入口已固定使用 24.13。

## [1.4.3] - 2026-08-26
### 修复
- **未发送批注不再跨会话/页面切换丢失（issue #28）**：待发送批注原先只存于内存，切换会话或刷新页面后静默丢失。现按会话 ID 持久化到 localStorage（`dsh.annotation.pending.v1.<sessionId>`，Range 不可序列化故剥离、锚点元数据保留）；切换会话先写旧会话再读新会话，刷新后进入会话即恢复，恢复时按 seqKey/行首/上下文模糊搜索重新锚定并重绘脚注与高亮；发送成功或手动删除后才清空；损坏数据自动忽略并回退为空列表。回归测试见 `test/pending-storage.test.mjs`。

### 性能
- **流式期间不再逐 mutation 批次全文档扫描（issue #31）**：decorateAll 原先在 body 全树 MutationObserver（childList: subtree: characterData: attributes:）的每个相关批次上同步执行——流式输出期的主体批次是 attributes/characterData（实测 20s 内 245 批次、0 个 childList），每次都是 querySelectorAll('[data-chat-flow-kind]') + 每行子树查询 + textContent，成本随会话长度线性增长。现在只有含 childList（消息行插入）的批次才同步执行完整装饰（保证「隐藏批注块」先于绘制，无闪烁回归）；流式批次改为 500ms 限流的助手芯片增量扫描（行内 data-streaming 守卫不变，芯片替换时序不变）；1s 兜底轮询保留。实测 20s 流式窗口 CPU 采样中 querySelectorAll 命中从 ~100 降至 17，decorateAll 不再出现在热路径；长会话（500+ 行）预期每帧节省 1-4ms 主线程。

## [1.4.2] - 2026-08-24
### 文档
- 在中英文 README 中补充原生 `npm install @changfenhuang/dsh-annotation` 命令，并明确它只添加 Node 依赖；安装并激活 DSH 插件仍使用 `dsh plugin add`。
- 产品站安装命令同步改为 npm 公开包。

## [1.4.1] - 2026-08-18
### 发布
- npm 发布作用域改为个人账号 `@changfenhuang/dsh-annotation`；GitHub 仓库继续保留在 `omdsh-dev` 组织。同步更新运行时模块标识、资源路由和安装文档，不保留旧 npm 名称兼容层。

### 修复
- **斜杠命令不再被批注拼稿降级（issue #20）**：有待发送批注时输入 `/goal` 等命令并回车，v1.4.1 会把批注块前置进草稿，破坏 DSH 输入机的命令 token 前缀（watchClaim 释放声明），命令被降级为普通消息发出、goal 无法启用。现在命令草稿原样放行、不拼批注，批注保留并随下一条普通消息附带，同时弹 toast 提示（zh/en）。
- **恢复 Cmd/Ctrl+Enter 纯批注直接发送（issue #17）**：v1.3.18 为修 issue #10 把修饰键 Enter 全部排除，导致空草稿时 Cmd/Ctrl+Enter 无法直接发送纯批注。现仅在草稿为空时接管 Cmd/Ctrl+Enter，并在 capture 阶段主动 `submit('queue')`，避免 composer 的 accelerated 路径在「运行中 + 有排队消息」时误走 steerQueue 而把批注块留在输入框；草稿已有文字时仍交由 composer 处理，保留宿主的 Queue / Steer 策略。
### 兼容性
- **dsh 0.1.0-rc.8**：确认浏览器模块加载、会话作用域、输入提交、语言切换及批注依赖的页面锚点均保持兼容；无需增加兼容层，`npm run check` 全通过。
- **dsh 0.1.1-rc.2**：确认浏览器模块加载、会话作用域、输入提交、语言订阅及页面锚点契约仍保持兼容；无需增加兼容层，`npm run check` 3/3 通过，并在 rc.2 真实 Web 页面确认脚本加载与样式注入。

## [1.4.0] - 2026-08-18
### 新功能
- **语言跟随 DSH（issue #11）**：接入 `@deepseek-ai/dsh-client-locale` 的 `locale` 服务（`ctx.locale.getSnapshot().active` + `subscribe()`），UI 文案与批注协议块按 `zh`/`en` 双语生成与实时切换；气泡隐藏手术与反解析同时兼容 `提问：`/`Ask:`、`批注：`/`Note: ` 及「问题：」老格式，历史消息跨语言切换可解析；回复芯片保持语言中立的 `Annotation N`；locale 服务缺失时回退 zh，行为与旧版一致。

## [1.3.18] - 2026-08-18
### 修复
- **修饰键 + Enter 不再误触发拼稿（issue #10）**：`onKeyDown` 的 composer Enter 拦截只处理裸 Enter——Ctrl/Meta+Enter（官方 accelerated 提交）、Shift+Enter（换行）与浏览器默认换行路径都不会再调用 `attachAndSend`，批注块不再以明文出现进输入框；IME 守卫（isComposing / keyCode 229 / compositionend latch）保持不变。

## [1.3.17] - 2026-08-18
### 兼容性
- **dsh 0.1.0-rc.7 适配核查（无需代码改动）**：Node half 为零依赖空实现、`client.js` 自包含，不依赖任何 `@deepseek-ai/*` 运行时包；`dsh.client.inject` 依赖的 `@deepseek-ai/dsh-client-runtime` / `@deepseek-ai/dsh-client-ui-conversation` 在 rc.7 契约不变；rc.7 conversation 新增 Safari textarea 修复不影响本插件依赖的 `data-composer-card` / `data-streaming` / `data-chat-flow` / `data-chat-anchor-key` / `data-time-hover-root` / `data-turn-tail` / `data-input-scroll` 等选择器；`npm run check` 通过，rc.7 全量 web 演练及线上健康检查通过。
