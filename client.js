// annotation-for-dsh 的浏览器端 half（client bundle）。
//
// 手写 CJS + ModuleLoader 包装（同 omdsh-dev navbar/greeter 模式，零构建
// 步骤）：纯 DOM 自渲染，无任何 @deepseek-ai 值导入（bundle purity gate 合规）；
// cordis 服务经 exports.inject 的字符串名接入（sessions / conversation / locale）。
//
// v1.4.x · 自包含批注流（取代 v0.9 chip 设计与 v1.0 发送面板）：
//   1. 选中助手文字 → 工具条「批注」→ 写批注（可留空 = 仅标记原文）
//   2. 保存后原文亮蓝编号 + 高亮（纯视觉，不弹窗）；跨消息/跨回合连续累积
//   3. 输入框旁「批注 ×N」标签：悬浮可见全部内容、可逐条删除
//   4. 回车发送：capture 阶段拦截 Enter（IME 守卫对齐官方 InputBar：isComposing /
//      keyCode 229 + compositionend 后短延迟 latch）→ 批注块 prepend 进草稿
//      （setDraft，不覆盖用户文字）→ composer 正常提交
//   5. 用户气泡不显示批注块：MutationObserver 微任务阶段（绘制前）按最后一个
//      「提问：」切掉批注块、贴「批注 ×N」标签（hover 可见）；1s 轮询兜底 +
//      历史消息自动修复（用户气泡是 MessageText 单文本节点，非 markdown）
//   6. 回复逐条对照：批注块末尾注入格式指令，模型按「Annotation N：…」逐条
//      回应；回复渲染完成（data-streaming 移除）后把「Annotation N：」替换为
//      可悬浮芯片（数据取最近一条带标签用户消息的 tag.__annotationItems，刷新
//      自动重建；改 DOM 前先快照 TreeWalker 收集的文本节点再逐个替换，遍历
//      中途 replaceChild 会让 walker 指针失效）
//   7. 语言跟随 DSH locale 服务（v1.4）：UI 文案与协议块 zh/en 双语、实时切换，
//      隐藏手术与反解析同时兼容「提问：」/「Ask:」与「问题：」老格式
//
// v1.4.12 · 工具条定位改为「划选结束时鼠标停留位置的正下方」（pointer 落点追踪；
//   键盘 / 双击划选回退选区矩形定位），不再居中于整个选区、不再压住选区下方正文。
//
// v1.4.13 · 修复「同时出现两个批注按钮」（teardown 单槽引用被覆盖 → 旧浮层残留；
//   改为实例注册表逐个撤销 + 选择器清场兜底）与「按钮四周一圈透明灰色光晕」
//   （浮层不再用半透明菜单填充 + 40px 背景模糊 + 全透明描边；改插件自有的不透明
//   表面变量 + 轻投影 + 实体细描边，不依赖会被皮肤覆盖的主题 token）。
//
// v1.4.14 · 残留清场的两个触发点补齐：decorateAll 周期清场（兜住启动后新塞入的
//   残留层）+ teardown 清场（撤销自己后顺带清掉历史遗留层）。
//
// v1.4.15 · teardown 清场加「当前实例」守卫：旧实例被延迟 dispose 时不再误删
//   新实例的浮层。
//
// v1.4.16 · 修复「有时候工具条不在鼠标下方」：拖动越出视口时不再丢弃指针锚点
//   （钳到最近边缘），且真实拖动一经确认即置可信（不依赖 pointerup，窗口外松开
//   也能贴鼠标），并补 pointercancel 收尾。
//
// v1.4.17 · 修复「反向划选时工具条不紧贴鼠标」：旧实现固定取
//   Math.max(point.y, rect.bottom)，反向划选时光标在选区上沿，必然取到
//   rect.bottom，工具条被推到整个选区之外。改为按「光标在选区哪一半」决定
//   贴光标上方还是下方，正反向都紧贴光标且不压正文；placeAbove 同时改用实测
//   宽度（原硬编码 400 会把窄选区推到视口最左边）。
//
// v1.4.18 · 定位优先级收敛为「紧贴光标 → 让开选区 → 翻侧 → 视口夹取」：
//   修好光标落在选区内部空档行时「贴光标」与「不压正文」互相冲突的情况。
//
// v1.4.19 · 「让开选区」改为候选 + 容差（4px）评估：修好 v1.4.18 因 1px 边缘交叠
//   就把工具条推到整个选区之外的问题，恢复「紧贴光标」。
//
// v1.4.20 · 工具条方向恒定：一律出现在光标下方，不再按划选方向翻上翻下
//   （仅当光标贴近视口底部、下方确实放不下时才翻到上方）。
//
// v1.4.21 · 修复「有批注但输入框为空时，必须先随便打点字才能点发送按钮」：
//   宿主 InputBar 的发送按钮在草稿为空时是 disabled 的
//   （primaryDisabled = empty || disabled || machineBusy || uploadsPending，
//    empty = draft.trim() === '' && attachments.length === 0），
//   而浏览器不会给 disabled 的表单控件派发 pointer/mouse 事件——v1.4.20 及之前
//   监听按钮 pointerdown 的写法因此从未生效（注释里的假设是错的）。
//   现在：有批注待发送且草稿为空时主动摘掉按钮的 disabled（视觉与功能一致地变为
//   可用），capture 阶段接管 click 走插件自己的纯批注提交；草稿非空、按钮变成
//   停止/排队/插话、输入区 aria-disabled、或无待发送批注时立即把 disabled 还回去。
//   宿主拒绝提交（附件还在上传等）时 toast 如实告知，不假装成功。
//
// v1.4.22 · v1.4.21 的加固（审计「会不会绕过宿主守卫」时查出的两个窄口子）：
//   1. **有附件时不接管**：有附件时宿主的 empty 不成立（empty = 草稿空 && 无附件），
//      按钮仍被禁用就只可能是「附件还在上传」（uploadsPending）——那时接管等于绕过宿主的
//      守卫。现在直接让开，由宿主自己的错误通知说明原因。
//   2. **提交途中不重新接管**：宿主靠 primaryDisabled 里的 machineBusy 防止「提交途中再
//      提交」，我们摘掉了 disabled 就得自己补这道闸，否则双击的第二下会在提交途中再喂一次
//      enter（宿主的 submit(mode) 不幂等，mode="queue" 会把第二条排进队列）。现在从提交
//      那一刻起上闸，直到 pending 批注被消费（或用户重新输入 / 兜底 5s 超时）才解锁。
//   3. **还原 disabled 时要求按钮仍是「普通发送」按钮**：运行中它会变成停止按钮，误设
//      disabled 会把「停止」点不了。
//
// v1.4.23 · 修复「点发送的瞬间能看到批注原文一闪而过」：
//   隐藏手术原先只认「含 childList 的批次」同步执行（v1.4.3 为省流式开销做的优化），
//   前提假设是「行插入批次本身就携带完整批注块」。但用户消息气泡可能先插入空行、再由
//   React 的 commitTextUpdate 把文本写进**已有的**文本节点——那是 characterData 批次，
//   原先只触发 500ms 限流的助手扫描，于是批注块先被画出来（用户看到原文一闪而过），
//   要等 1s 兜底轮询才隐藏。现在发送时打开一个「期待新气泡」窗口（≤2s）：窗口内任何
//   相关批次都同步跑隐藏手术。
//   （本版还写了个错的收尾——「最新一条装饰成功即收起窗口」，见 v1.4.24 第 3 条。）
//
// v1.4.24 · 「原文一闪而过」的真正修复（用户实测确认无闪）：
//   真因（读宿主源码确认）：宿主的**提交回显气泡** `PendingSubmissionBubble`
//   （dsh-client-ui-chat）注释里写明「visible from the submit click until the durable
//   user/message renders」——它从点击那一刻就把草稿原文显示出来；而 `ChatNodeList` 把
//   pendingRows 直接追加在列表末尾、没有 ChatNodeSeat 包装，所以它拿不到
//   data-chat-flow-kind → allMessageRows() 永远看不到它，插件从来没管过它。
//   v1.4.23 的窗口打的是别处，所以照旧闪。现在：
//     1. hideDockEchoBlocks() 处理 [data-submission-echo]：反解析条目 → 隐藏块 → 贴
//        「批注 ×N」，与普通气泡同一套路径。注意必须让 hideAnnotationBlock 自己落到
//        [class*="bubble"] 上——把整个 userRow 当容器时，行里的时间戳会让判定失败
//        （本版初版就是这么错的，用户实测仍闪）；
//     2. 纯批注的判定不再要求「整段文本恰好等于块本身」：定位 headOnly…formatOnly 区间并用
//        cutRange 切掉它，保留容器里其它文本（时间戳 / 操作按钮 / 回显状态字）；
//     3. 窗口（v1.4.23 引入）保留，但**不再「第一次隐藏成功就收窗」**——那正是 v1.4.23 没
//        生效的原因；现在按时间过期，靠 O(1) 的 freshBubbleNeedsHide() 决定要不要全量扫描。
//
// 消息格式（zh）：我批注了以下 N 处内容…\n\n1. 原文\n   批注：…\n\n
//           请用「Annotation 1：…」…\n\n提问：
// （en 用 I annotated the following N passage(s)… + Note: … + Ask:；
//   zh 分隔标记用「提问：」而非「问题：」——标题行「回答我的问题：」里也含
//   它，气泡隐藏手术会误命中）
//
// 发送清空只认 watchInputDraft 的「草稿有→空」迁移（未就绪时订阅重试补齐）；
// 气泡装饰走 MutationObserver + 轮询，只负责隐藏/贴标签，绝不清空待发送批注
// （历史消息重装饰与刚发送在 DOM 上不可区分，见 decorateAll）。
//
// 判别式与 omdsh-dev/navbar 一致：助手行 = [data-time-hover-root] 且不含
// user bubble（[class*="bubble"]）。
// focus-chat（@dingyi222666/dsh-focus-chat）兼容：其会话视图挂载在
// [data-focus-flow] 内，助手行 = class 含 "assistant" 的容器（CSS Modules
// 哈希名形如 `<hash>_assistant`，流式期间行自带 data-streaming），用户行
// 沿用 data-time-hover-root；切换视图 tab 时主视图会卸载，故行判别必须
// 同时覆盖两种视图结构（见 assistantRows / allMessageRows / assistantRowOf）。
window.__ModuleLoader__.load({
  // 必须与 package.json "name" 完全一致，否则 client-modules 报：
  // bundle loaded without registering "@changfenhuang/dsh-annotation"
  id: '@changfenhuang/dsh-annotation',
  factory: (require) => {
    'use strict'
    var module = { exports: {} }
    var exports = module.exports

    // ============================== 样式 ==============================
    var STYLE_ID = 'annotation-for-dsh-style'
    if (document.getElementById(STYLE_ID) === null) {
      var style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = [
        // 浮层表面（修复「一圈透明灰色光晕」）：不透明 + 无背景模糊 + 实体描边。
        // 用插件自有变量名，不依赖 --dsw-specific-menu 等会被皮肤覆盖的 token。
        // 定义在 body 上，直接挂在 body 下的 chip / tip / toast 也能继承。
        // （all: initial 不重置自定义属性，host 子树照常继承。）
        'body { --dsh-ann-surface: #ffffff; --dsh-ann-border: rgba(0, 0, 0, .12); }',
        'body[data-ds-dark-theme] { --dsh-ann-surface: #2c2c2e;',
        '  --dsh-ann-border: rgba(255, 255, 255, .14); }',
        '[data-annotation-for-dsh] { all: initial; }',
        '[data-annotation-for-dsh] * { box-sizing: border-box; }',
        '.dsh-ann-bar { position: fixed; z-index: 1200; display: flex; align-items: center;',
        '  gap: 2px; padding: 4px; border-radius: 12px;',
        '  border: 1px solid var(--dsh-ann-border, rgba(0, 0, 0, .12));',
        '  background: var(--dsh-ann-surface, #fff);',
        '  backdrop-filter: none;',
        '  -webkit-backdrop-filter: none;',
        '  box-shadow: var(--dsw-shadow-lv2);',
        '  font-family: var(--dsw-font-family, system-ui);',
        '  animation: dsh-ann-pop .12s var(--ds-ease-in-out, ease); }',
        '@keyframes dsh-ann-pop { from { opacity: 0; transform: translateY(3px); }',
        '  to { opacity: 1; transform: none; } }',
        '.dsh-ann-ghost { display: inline-flex; align-items: center; gap: 5px; height: 28px;',
        '  padding: 0 10px; border: none; border-radius: 14px; background: transparent;',
        '  color: var(--dsw-alias-label-primary); font-family: inherit;',
        '  font-size: 12px; line-height: 18px; cursor: pointer; }',
        '.dsh-ann-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }',
        '.dsh-ann-ghost:disabled { opacity: .45; cursor: default; }',
        '.dsh-ann-ghost svg { width: 14px; height: 14px; }',
        '.dsh-ann-action { display: inline-flex; align-items: center; gap: 5px; height: 28px;',
        '  padding: 0 12px; border: none; border-radius: 14px;',
        '  background: var(--dsw-alias-button-primary-fill);',
        '  color: var(--dsw-alias-label-primary-foreground);',
        '  font-family: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }',
        '.dsh-ann-action:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }',
        '.dsh-ann-action:disabled { opacity: .4; cursor: default; }',
        '.dsh-ann-action svg { width: 14px; height: 14px; }',
        '.dsh-ann-icon { display: inline-flex; align-items: center; justify-content: center;',
        '  width: 28px; height: 28px; padding: 0; border: none; border-radius: 28px;',
        '  background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }',
        '.dsh-ann-icon:hover { background: var(--dsw-alias-interactive-bg-hover);',
        '  color: var(--dsw-alias-label-secondary); }',
        '.dsh-ann-icon svg { width: 14px; height: 14px; }',
        '.dsh-ann-card { position: fixed; z-index: 1201; width: 400px;',
        '  max-width: calc(100vw - 16px); padding: 12px; border-radius: 12px;',
        '  border: 1px solid var(--dsh-ann-border, rgba(0, 0, 0, .12));',
        '  background: var(--dsh-ann-surface, #fff);',
        '  backdrop-filter: none;',
        '  -webkit-backdrop-filter: none;',
        '  box-shadow: var(--dsw-shadow-lv2);',
        '  font-family: var(--dsw-font-family, system-ui);',
        '  animation: dsh-ann-pop .12s var(--ds-ease-in-out, ease); }',
        '.dsh-ann-card-head { display: flex; align-items: center; justify-content: space-between;',
        '  margin-bottom: 8px; cursor: move; touch-action: none; user-select: none; }',
        '.dsh-ann-card-title { font-size: 13px; font-weight: 600;',
        '  color: var(--dsw-alias-label-primary); }',
        '.dsh-ann-quote { font-size: 12px; line-height: 1.55;',
        '  color: var(--dsw-alias-label-tertiary);',
        '  border-left: 2px solid var(--dsw-alias-border-inverted);',
        '  background: var(--dsw-alias-bg-layer-1);',
        '  border-radius: 0 8px 8px 0; padding: 6px 10px; margin-bottom: 8px;',
        '  max-height: 72px; overflow: hidden; word-break: break-word;',
        '  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }',
        '.dsh-ann-quotes { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px;',
        '  max-height: 150px; overflow-y: auto; }',
        '.dsh-ann-qitem { display: flex; align-items: flex-start; gap: 8px; padding: 6px 8px;',
        '  border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }',
        '.dsh-ann-qnum { flex: none; display: inline-flex; align-items: center; justify-content: center;',
        '  width: 16px; height: 16px; margin-top: 1px; border-radius: 8px;',
        '  background: var(--dsw-alias-text-accent, #4c9aff); color: #fff;',
        '  font-size: 10px; font-weight: 700; }',
        '.dsh-ann-qbody { flex: 1; min-width: 0; }',
        '.dsh-ann-qtext { font-size: 12px; line-height: 1.5;',
        '  color: var(--dsw-alias-label-tertiary); max-height: 36px; overflow: hidden;',
        '  word-break: break-word; display: -webkit-box; -webkit-line-clamp: 2;',
        '  -webkit-box-orient: vertical; }',
        '.dsh-ann-qnote { font-size: 11px; line-height: 1.5; margin-top: 2px;',
        '  color: var(--dsw-alias-label-secondary); max-height: 34px; overflow: hidden;',
        '  word-break: break-word; white-space: pre-wrap; display: -webkit-box;',
        '  -webkit-line-clamp: 2; -webkit-box-orient: vertical; }',
        '.dsh-ann-qdel { flex: none; display: inline-flex; align-items: center; justify-content: center;',
        '  width: 18px; height: 18px; padding: 0; border: none; border-radius: 9px;',
        '  background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }',
        '.dsh-ann-qdel:hover { background: var(--dsw-alias-interactive-bg-hover);',
        '  color: var(--dsw-alias-label-secondary); }',
        '.dsh-ann-qdel svg { width: 10px; height: 10px; }',
        '.dsh-ann-input { width: 100%; min-height: 64px; padding: 8px 10px;',
        '  border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;',
        '  background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);',
        '  font-family: inherit; font-size: 13px; line-height: 20px;',
        '  outline: none; resize: vertical; transition: border-color .15s ease; }',
        '.dsh-ann-input:focus { border-color: var(--dsw-alias-text-accent, #4c9aff); }',
        '.dsh-ann-input::placeholder { color: var(--dsw-alias-label-dimmed); }',
        '.dsh-ann-row { display: flex; gap: 8px; margin-top: 10px; justify-content: flex-end; }',
        '.dsh-ann-cancel { display: inline-flex; align-items: center; height: 28px; padding: 0 12px;',
        '  border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px;',
        '  background: transparent; color: var(--dsw-alias-label-primary);',
        '  font-family: inherit; font-size: 12px; cursor: pointer; }',
        '.dsh-ann-cancel:hover { background: var(--dsw-alias-interactive-bg-hover); }',
        '.dsh-ann-error { color: var(--dsw-alias-state-error-primary, #ff7a7a);',
        '  font-size: 12px; margin-top: 8px; word-break: break-word; }',
        '.dsh-ann-hl { position: fixed; z-index: 900; background: rgba(255, 195, 0, .15);',
        '  border-radius: 2px; pointer-events: none; animation: dsh-ann-fadein .15s ease; }',
        '.dsh-ann-num { position: fixed; z-index: 940; display: inline-flex; align-items: center;',
        '  justify-content: center; min-width: 16px; height: 16px; padding: 0 4px;',
        '  border-radius: 8px; border: 1px solid rgba(255, 255, 255, .3);',
        '  background: var(--dsw-alias-text-accent, #4c9aff); color: #fff;',
        '  font-family: var(--dsw-font-family, system-ui); font-size: 10px; font-weight: 700;',
        '  box-shadow: 0 1px 4px rgba(0,0,0,.35); pointer-events: auto; cursor: pointer;',
        '  transition: filter .12s ease; }',
        '.dsh-ann-num:hover { filter: brightness(1.15); }',
        'body:has([role="dialog"][aria-modal="true"]) [data-annotation-overlay] { display: none; }',
        '.dsh-ann-tip { animation: dsh-ann-pop .12s var(--ds-ease-in-out, ease); }',
        '@keyframes dsh-ann-fadein { from { opacity: 0; } to { opacity: 1; } }',
      ].join('\n')
      document.head.appendChild(style)
    }

    // ============================== i18n（zh / en） ==============================
    // UI 文案与批注协议块双语化：当前语言由 DSH 的 locale 服务驱动
    // （ctx.locale.getSnapshot().active + subscribe()），服务缺失时回退 zh。
    // 历史消息的隐藏手术与反解析同时兼容 zh/en 标记，跨语言切换不丢批注。
    var STR = {
      zh: {
        actions: {
          annotate: '批注',
          already: '已批注',
          annotateTitle: '为选中的内容写一条批注',
          alreadyTitle: '这段内容已在批注清单中',
        },
        edit: {
          addTitle: '添加批注',
          editTitle: '编辑批注',
          placeholder: '写下批注…（可留空，保存后仅标记原文）',
          save: '保存批注',
        },
        common: { cancel: '取消' },
        error: { noSelection: '没有选中的内容' },
        chip: { count: '条批注' },
        tip: { title: '批注（{n} 条）', notePrefix: '批注：', del: '删' },
        bubble: { tag: '批注 ×{n}', title: '本消息携带批注（{n} 条）' },
        reply: {
          headWithQuote: '批注 {n} 的原文',
          headNoQuote: '批注 {n}',
          notePrefix: '你的批注：',
          missing: '（未找到对应批注条目）',
        },
        toast: {
          attachFail: '批注拼稿失败，消息将不带批注发送：',
          skipCommand: '本条是斜杠命令，未拼入批注；批注已保留，将随下一条消息发送',
          sendBlocked: '批注未能发出（附件可能还在上传），请稍后重试：',
        },
        block: {
          head: '我批注了以下 {n} 处内容（编号与原文对应），请针对它们回答我的问题：',
          notePrefix: '批注：',
          format: '请用「Annotation 1：…」到「Annotation {n}：…」的格式，逐条回应上面每一条批注，最后再回答我的问题。',
          headOnly: '我批注了以下内容，请逐条回应：',
          formatOnly: '请按「Annotation N：…」的格式，逐条回应以上批注。',
          marker: '提问：',
        },
      },
      en: {
        actions: {
          annotate: 'Annotate',
          already: 'Annotated',
          annotateTitle: 'Write a note about the selected text',
          alreadyTitle: 'This passage is already in your annotation list',
        },
        edit: {
          addTitle: 'Add annotation',
          editTitle: 'Edit annotation',
          placeholder: 'Write a note… (optional; saving only marks the passage)',
          save: 'Save annotation',
        },
        common: { cancel: 'Cancel' },
        error: { noSelection: 'No text selected' },
        chip: { count: ' annotation(s)' },
        tip: { title: 'Annotations ({n})', notePrefix: 'Note: ', del: 'Del' },
        bubble: { tag: 'Annotations ×{n}', title: 'This message carries {n} annotation(s)' },
        reply: {
          headWithQuote: 'Source of annotation {n}',
          headNoQuote: 'Annotation {n}',
          notePrefix: 'Your note: ',
          missing: '(no matching annotation found)',
        },
        toast: {
          attachFail: 'Failed to attach annotations; the message will be sent without them: ',
          skipCommand: 'Slash command detected — annotations stay pending and will attach to your next message',
          sendBlocked: 'Annotation was not sent (an attachment may still be uploading); try again: ',
        },
        block: {
          head: 'I annotated the following {n} passage(s) (the numbers match the quotes below); please respond to them when answering my question:',
          notePrefix: 'Note: ',
          format: 'Please respond to each annotation in the format "Annotation 1: …" through "Annotation {n}: …", then answer my question.',
          headOnly: 'I annotated the following passages; please respond to each annotation:',
          formatOnly: 'Please respond to each annotation above in the format "Annotation N: …".',
          marker: 'Ask:',
        },
      },
    }
    var currentLang = 'zh'
    function setLang(id) {
      currentLang = (id === 'en' || id === 'zh') ? id : 'zh'
    }
    function dictVal(lang, key) {
      var cur = STR[lang]
      var parts = key.split('.')
      for (var i = 0; i < parts.length; i++) {
        if (cur === undefined || cur === null) return undefined
        cur = cur[parts[i]]
      }
      return cur
    }
    /** @param {string} key @param {Object<string, string|number>} [params] */
    function t(key, params) {
      var s = dictVal(currentLang, key)
      if (s === undefined) s = dictVal('zh', key)
      if (s === undefined) s = key
      if (params !== undefined && params !== null) {
        for (var k in params) {
          if (Object.prototype.hasOwnProperty.call(params, k)) {
            s = s.split('{' + k + '}').join(String(params[k]))
          }
        }
      }
      return s
    }
    // 批注块头部哨兵（zh/en 都识别；兼容历史消息与跨语言切换）。
    var BLOCK_HEADS = { zh: '我批注了以下', en: 'I annotated the following' }
    function hasAnnotationBlock(text) {
      return text.indexOf(BLOCK_HEADS.zh) !== -1 || text.indexOf(BLOCK_HEADS.en) !== -1
    }
    // 气泡隐藏手术的分隔标记：当前语言优先，另保留另一语言与「问题：」老格式。
    var BLOCK_MARKERS = {
      zh: ['\n提问：', '提问：', '\n问题：', '问题：'],
      en: ['\nAsk:', 'Ask:'],
    }
    function blockMarkers() {
      return currentLang === 'en'
        ? BLOCK_MARKERS.en.concat(BLOCK_MARKERS.zh)
        : BLOCK_MARKERS.zh.concat(BLOCK_MARKERS.en)
    }
    // 反解析用的段落级分隔标记（批注块按协议生成，均以 \n\n 开头）。
    var PARSE_MARKERS = ['\n\n提问：', '\n\n问题：', '\n\nAsk:']

    // ============================== 工具 ==============================
    // 助手行判别：0810 snapshot 起助手消息行 = ChatNodeSeat 上的
    // data-chat-flow-kind="assistant-step"（旧版 data-time-hover-root 已不再
    // 出现在助手消息主体上，只留在用户行与 turn 尾节点）；保留旧判别式兜底
    // 兼容回滚旧 snapshot，并排除新版 data-turn-tail 误判。
    function isAssistantRow(el) {
      if (el.matches('[data-chat-flow-kind="assistant-step"]')) return true
      return el.hasAttribute('data-time-hover-root')
        && el.querySelector('[class*="bubble"]') === null
        && !el.hasAttribute('data-turn-tail')
    }

    // ---------- focus-chat（@dingyi222666/dsh-focus-chat）视图兼容 ----------
    // 该插件在 conversation.view 槽注册「聚焦会话」视图：挂载于
    // [data-focus-flow]（列容器）→ [data-focus-anchor-key]（行包装）→ 行。
    // 助手行 = class 含 "assistant" 的容器（CSS Modules 哈希名保留 local 名，
    // 形如 `<hash>_assistant`；流式期间行自带 data-streaming，停流后移除）。
    // 用户行保留 data-time-hover-root + [class*="bubble"]，与旧判别式一致。
    function isFocusFlow(el) {
      return el !== null && typeof el.closest === 'function'
        && el.closest('[data-focus-flow]') !== null
    }

    function isFocusAssistantRow(el) {
      if (el === null || !el.classList || !isFocusFlow(el)) return false
      for (var i = 0; i < el.classList.length; i++) {
        if (el.classList[i].indexOf('assistant') !== -1) return true
      }
      return false
    }

    /** focus 视图的全部消息行（用户 + 助手，DOM 顺序）。只保留最外层助手
     *  容器（markdown 内部子元素也可能带含 assistant 的类名）。 */
    function focusMessageRows() {
      var flow = document.querySelector('[data-focus-flow]')
      if (flow === null) return []
      var out = []
      var all = flow.querySelectorAll('[data-time-hover-root], [class*="assistant"]')
      for (var i = 0; i < all.length; i++) {
        var el = all[i]
        if (el.hasAttribute('data-time-hover-root')) {
          if (!isAssistantRow(el)) out.push(el)
          continue
        }
        if (!isFocusAssistantRow(el)) continue
        var p = el.parentElement
        if (p !== null && p !== flow && isFocusAssistantRow(p)) continue
        out.push(el)
      }
      return out
    }

    function assistantRowOf(node) {
      var el = (node instanceof Element) ? node : (node !== null ? node.parentElement : null)
      while (el !== null && el !== document.body) {
        if (el.hasAttribute('data-chat-flow-kind')) {
          return el.getAttribute('data-chat-flow-kind') === 'assistant-step' ? el : null
        }
        if (el.hasAttribute('data-time-hover-root')) {
          return isAssistantRow(el) ? el : null
        }
        if (isFocusAssistantRow(el)) {
          // 冒到最外层 focus 助手容器（内部子元素可能也含 assistant 类名）。
          while (el.parentElement !== null && el.parentElement !== document.body
            && isFocusAssistantRow(el.parentElement)) {
            el = el.parentElement
          }
          return el
        }
        el = el.parentElement
      }
      return null
    }

    // 只接管宿主的可选文本正文；标题、按钮、PDF 和 iframe 不属于此接口。
    var DOCUMENT_TEXT = '[data-textpreview-plain], [data-document-markdown], [data-code-preview] pre'

    function documentSourceOf(node) {
      var el = node instanceof Element ? node : node && node.parentElement
      if (el && el.closest('button, input, textarea, [contenteditable="true"]')) return null
      var root = el && el.closest(DOCUMENT_TEXT)
      var preview = root && root.closest('[data-textpreview-url]')
      if (!preview) return null
      var url = preview.getAttribute('data-textpreview-url') || ''
      var match = /^dsh-resource:\/\/file\/session\/([^/]+)\/(.+)$/.exec(url)
      if (!match) return null
      try {
        var sessionId = decodeURIComponent(match[1])
        var path = match[2].split('/').map(decodeURIComponent).join('/')
        if (/[\u0000-\u001f\u007f]/.test(path) || /[?#]/.test(url)) return null
        return { root: root, sourceUrl: url, sourcePath: path, sessionId: sessionId }
      } catch (_) { return null }
    }

    function annotationRootOf(node) {
      var source = documentSourceOf(node)
      return source !== null ? source.root : assistantRowOf(node)
    }

    function quoteRects(range, saved) {
      var rects = Array.from(range.getClientRects())
      if (!saved.sourceUrl) return rects
      var clip = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
      var node = range.commonAncestorContainer
      var el = node instanceof Element ? node : node.parentElement
      for (; el && el !== document.body; el = el.parentElement) {
        var style = getComputedStyle(el)
        var box = el.getBoundingClientRect()
        if (/auto|scroll|hidden|clip/.test(style.overflowX)) {
          clip.left = Math.max(clip.left, box.left); clip.right = Math.min(clip.right, box.right)
        }
        if (/auto|scroll|hidden|clip/.test(style.overflowY)) {
          clip.top = Math.max(clip.top, box.top); clip.bottom = Math.min(clip.bottom, box.bottom)
        }
      }
      return rects.map(function (r) {
        var left = Math.max(r.left, clip.left), top = Math.max(r.top, clip.top)
        return new DOMRect(left, top, Math.max(0, Math.min(r.right, clip.right) - left), Math.max(0, Math.min(r.bottom, clip.bottom) - top))
      }).filter(function (r) { return r.width > 0 && r.height > 0 })
    }

    function quoteWithSource(q) {
      return q.sourcePath ? '[' + q.sourcePath + ']\n' + q.text : q.text
    }

    function assistantRows() {
      var modern = document.querySelectorAll('[data-chat-flow-kind="assistant-step"]')
      if (modern.length > 0) return Array.prototype.slice.call(modern)
      var focus = focusMessageRows().filter(isFocusAssistantRow)
      if (focus.length > 0) return focus
      return Array.prototype.slice.call(document.querySelectorAll('[data-time-hover-root]'))
        .filter(isAssistantRow)
    }

    /** 全部消息行（用户 + 助手 + 其它节点）：新版走 data-chat-flow-kind，
     *  旧版回退 data-time-hover-root；focus-chat 视图单独按 DOM 顺序收集
     *  （会话视图 tab 切换时主视图会卸载，两种结构不同时存在）。
     *  用于气泡装饰、批注条目回溯。 */
    function allMessageRows() {
      var modern = document.querySelectorAll('[data-chat-flow-kind]')
      if (modern.length > 0) return Array.prototype.slice.call(modern)
      var focus = focusMessageRows()
      if (focus.length > 0) return focus
      return Array.prototype.slice.call(document.querySelectorAll('[data-time-hover-root]'))
    }

    /** 由字符偏移在元素内构造 Range（跨文本节点）。 */
    function rangeFromOffset(el, offset, length) {
      var nodes = []
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      var n
      while ((n = walker.nextNode()) !== null) nodes.push(n)
      var pos = 0
      for (var i = 0; i < nodes.length; i++) {
        var len = (nodes[i].nodeValue || '').length
        if (offset < pos + len) {
          var range = document.createRange()
          range.setStart(nodes[i], offset - pos)
          var remain = length
          var j = i
          var inner = offset - pos
          while (remain > 0) {
            var l = (nodes[j].nodeValue || '').length
            var take = Math.min(remain, l - inner)
            remain -= take
            if (remain === 0) { range.setEnd(nodes[j], inner + take); break }
            j++
            inner = 0
          }
          return range
        }
        pos += len
      }
      return null
    }

    function findRangeIn(el, quote) {
      var full = ''
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      var n
      while ((n = walker.nextNode()) !== null) full += n.nodeValue || ''
      var start = full.indexOf(quote)
      if (start === -1) return null
      return rangeFromOffset(el, start, quote.length)
    }

    /** 空白完全剥离匹配：返回 quote 在 full 中的所有原始偏移区间 [{start,end}]。
     *  解决选区文本跨块级元素（GenUI 表格单元格等）带出 \n、而 DOM textContent
     *  无此空白导致的匹配失败（此前会掉进宽松匹配命中旧轮次）。 */
    function allNormSpans(full, quote) {
      var nq = quote.replace(/\s+/g, '')
      if (nq === '') return []
      var nf = ''
      var map = []
      for (var i = 0; i < full.length; i++) {
        if (!/\s/.test(full[i])) { nf += full[i]; map.push(i) }
      }
      var out = []
      var idx = nf.indexOf(nq)
      while (idx !== -1) {
        out.push({ start: map[idx], end: map[idx + nq.length - 1] + 1 })
        idx = nf.indexOf(nq, idx + 1)
      }
      return out
    }

    function findNormSpan(full, quote) {
      var spans = allNormSpans(full, quote)
      return spans.length > 0 ? spans[0] : null
    }

    /** 批注芯片差异变体：选区文本里芯片是「Annotation N」（无冒号），而消息行
     *  渲染文本可能是「Annotation N：」（React 重渲染后冒号恢复）——匹配失败时
     *  用变体重试，抹平该差异。 */
    function quoteVariants(quote) {
      var out = [quote]
      var re = /Annotation[\s\u200b\u200c\u200d\u00ad]*(\d+)/gi
      var m
      while ((m = re.exec(quote)) !== null) {
        out.push(quote.slice(0, m.index) + 'Annotation ' + m[1] + '：' + quote.slice(m.index + m[0].length))
      }
      return out
    }

    function allPositionsOf(el, quote) {
      var full = el.textContent || ''
      var out = []
      var idx = full.indexOf(quote)
      while (idx !== -1) {
        out.push(idx)
        idx = full.indexOf(quote, idx + 1)
      }
      return out
    }

    function ctxScore(full, pos, len, ctx) {
      if (ctx === null) return 0
      var before = full.slice(Math.max(0, pos - 24), pos)
      var after = full.slice(pos + len, pos + len + 24)
      var s = 0
      for (var i = 0; i < Math.min(before.length, ctx.before.length); i++) {
        if (before[i] === ctx.before[i]) s++
      }
      for (var j = 0; j < Math.min(after.length, ctx.after.length); j++) {
        if (after[j] === ctx.after[j]) s++
      }
      return s
    }

    /** 由 Range 起点算出它在元素文本内的绝对字符偏移（真实位置）。 */
    function offsetOfRangeInRow(row, range) {
      try {
        var walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
        var n
        var pos = 0
        while ((n = walker.nextNode()) !== null) {
          var len = (n.nodeValue || '').length
          if (n === range.startContainer) return pos + range.startOffset
          pos += len
        }
      } catch (_) { /* fallthrough */ }
      return -1
    }

    /** 宽松定位：token 式匹配，双向容忍空白差异。 */
    function findRangeFlexible(el, quote) {
      var qNorm = quote.replace(/\s+/g, ' ').trim()
      if (qNorm === '') return null
      var tokens = qNorm.split(' ').filter(function (t) { return t !== '' })
      if (tokens.length === 0) return null
      var nodes = []
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      var n
      while ((n = walker.nextNode()) !== null) nodes.push(n)
      var stream = []
      for (var i = 0; i < nodes.length; i++) {
        var text = nodes[i].nodeValue || ''
        for (var k = 0; k < text.length; k++) stream.push({ node: nodes[i], offset: k, ch: text[k] })
      }
      var t = 0
      var ti = 0
      var startNode = null
      var startOff = 0
      var endNode = null
      var endOff = -1
      var seenGap = false
      for (var s = 0; s < stream.length && t < tokens.length; s++) {
        var ch = stream[s].ch
        var isWs = /\s/.test(ch)
        if (isWs) {
          if (ti === 0) seenGap = true
          continue
        }
        if (ti === 0) {
          if (t > 0 && !seenGap) seenGap = true
          if (ch === tokens[t][0]) {
            if (t === 0) { startNode = stream[s].node; startOff = stream[s].offset }
            ti = 1
          } else {
            seenGap = true
            continue
          }
          if (tokens[t].length === 1) {
            endNode = stream[s].node
            endOff = stream[s].offset
            t++
            ti = 0
            seenGap = false
          }
          continue
        }
        if (ch === tokens[t][ti]) {
          ti++
          if (ti === tokens[t].length) {
            endNode = stream[s].node
            endOff = stream[s].offset
            t++
            ti = 0
            seenGap = false
          }
        } else {
          ti = 0
          if (ch === tokens[t][0]) {
            if (t === 0) { startNode = stream[s].node; startOff = stream[s].offset }
            ti = 1
            if (tokens[t].length === 1) {
              endNode = stream[s].node
              endOff = stream[s].offset
              t++
              ti = 0
              seenGap = false
            }
          }
        }
      }
      if (t === tokens.length && startNode !== null) {
        var range = document.createRange()
        range.setStart(startNode, startOff)
        range.setEnd(endNode, endOff + 1)
        return range
      }
      return null
    }

    /** 定位批注的 Range：消息 seq 锚定优先，空白不敏感重搜兜底。 */
    function locateQuote(quote, saved) {
      if (saved && saved.sourceUrl) {
        var bodies = document.querySelectorAll(DOCUMENT_TEXT)
        for (var d = 0; d < bodies.length; d++) {
          var source = documentSourceOf(bodies[d])
          if (source === null || source.sourceUrl !== saved.sourceUrl || bodies[d].getClientRects().length === 0) continue
          if (saved.range && bodies[d].contains(saved.range.commonAncestorContainer)
            && saved.range.toString().trim() === quote) return saved.range
          if (saved.textOffset >= 0) {
            var exact = rangeFromOffset(bodies[d], saved.textOffset, quote.length)
            if (exact !== null && exact.toString() === quote) return exact
          }
          // 文件变化后只接受唯一匹配，避免标记重复代码中的另一处。
          var text = bodies[d].textContent || ''
          var at = text.indexOf(quote)
          if (at >= 0 && text.indexOf(quote, at + 1) === -1) return rangeFromOffset(bodies[d], at, quote.length)
        }
        return null
      }
      if (saved !== undefined && saved !== null && saved.range && saved.range.startContainer) {
        try {
          if (saved.range.startContainer.isConnected && saved.range.endContainer.isConnected) {
            var t = saved.range.toString()
            if (t.replace(/\s+/g, '') === quote.replace(/\s+/g, '')) {
              return saved.range
            }
          }
        } catch (_) { /* range 已失效 */ }
      }
      var rows = assistantRows()
      if (saved !== undefined && saved !== null && saved.seqKey !== '') {
        try {
          var item = document.querySelector('[data-chat-anchor-key="' + saved.seqKey + '"]')
          // focus-chat 视图的锚 key 属性名不同，值语义一致。
          if (item === null) {
            item = document.querySelector('[data-focus-anchor-key="' + saved.seqKey + '"]')
          }
          if (item !== null) {
            var itText = item.textContent || ''
            if (saved.textOffset >= 0) {
              var sp0 = findNormSpan(itText, quote)
              if (sp0 !== null && Math.abs(sp0.start - saved.textOffset) <= 2) {
                var itRange = rangeFromOffset(item, sp0.start, sp0.end - sp0.start)
                if (itRange !== null) return itRange
              }
            }
            if (saved.ctxBefore !== '') {
              var itIdx = itText.indexOf(saved.ctxBefore)
              if (itIdx !== -1) {
                var itNear = itIdx + saved.ctxBefore.length
                var sp1 = findNormSpan(itText.slice(itNear), quote)
                if (sp1 !== null) {
                  var itRange2 = rangeFromOffset(item, itNear + sp1.start, sp1.end - sp1.start)
                  if (itRange2 !== null) return itRange2
                }
              }
            }
            // 锚点消息内的全量扫描（空白不敏感 + 上下文评分）。
            var spansIt = allNormSpans(itText, quote)
            var bestIt = null
            var bestItScore = -1
            for (var pp2 = 0; pp2 < spansIt.length; pp2++) {
              var rngIt = rangeFromOffset(item, spansIt[pp2].start, spansIt[pp2].end - spansIt[pp2].start)
              if (rngIt === null) continue
              var scIt = ctxScore(itText, spansIt[pp2].start, spansIt[pp2].end - spansIt[pp2].start,
                { before: saved.ctxBefore || '', after: saved.ctxAfter || '' })
              if (scIt > bestItScore) { bestItScore = scIt; bestIt = rngIt }
            }
            if (bestIt !== null && (saved.ctxBefore === '' || bestItScore > 0)) return bestIt
            // 锚点消息还在但原文匹配不上：先试批注芯片差异变体（「Annotation N」
            // vs「Annotation N：」）在**同一条消息内**宽松重定位——绝不跨消息
            // 模糊搜索（那是「跳到旧轮次」的根源，v1.3.6 纪律）。
            var variants = quoteVariants(quote)
            for (var vi = 0; vi < variants.length; vi++) {
              var vsp = allNormSpans(itText, variants[vi])
              for (var vj = 0; vj < vsp.length; vj++) {
                var vrng = rangeFromOffset(item, vsp[vj].start, vsp[vj].end - vsp[vj].start)
                if (vrng !== null) return vrng
              }
              var vflex = findRangeFlexible(item, variants[vi])
              if (vflex !== null) return vflex
            }
            // 同消息内确实定位不到 → 放弃（脚标隐藏）。
            return null
          }
        } catch (_) { return null }
      }
      if (saved !== undefined && saved !== null && saved.rowHead !== '') {
        for (var r = 0; r < rows.length; r++) {
          var rowText = rows[r].textContent || ''
          if (rowText.slice(0, 24) !== saved.rowHead) continue
          if (saved.textOffset >= 0) {
            var spR = findNormSpan(rowText, quote)
            if (spR !== null && Math.abs(spR.start - saved.textOffset) <= 2) {
              var range = rangeFromOffset(rows[r], spR.start, spR.end - spR.start)
              if (range !== null) return range
            }
          }
          if (saved.ctxBefore !== '') {
            var bIdx = rowText.indexOf(saved.ctxBefore)
            if (bIdx !== -1) {
              var near = bIdx + saved.ctxBefore.length
              var spR2 = findNormSpan(rowText.slice(near), quote)
              if (spR2 !== null) {
                var range2 = rangeFromOffset(rows[r], near + spR2.start, spR2.end - spR2.start)
                if (range2 !== null) return range2
              }
            }
          }
          var spans = allNormSpans(rowText, quote)
          var bestRow = null
          var bestRowScore = -1
          for (var pp = 0; pp < spans.length; pp++) {
            var rng = rangeFromOffset(rows[r], spans[pp].start, spans[pp].end - spans[pp].start)
            if (rng === null) continue
            var sc = ctxScore(rowText, spans[pp].start, spans[pp].end - spans[pp].start,
              saved !== undefined && saved !== null
                ? { before: saved.ctxBefore || '', after: saved.ctxAfter || '' }
                : null)
            if (sc > bestRowScore) { bestRowScore = sc; bestRow = rng }
          }
          if (bestRow !== null) return bestRow
        }
      }
      var ctx = saved !== undefined && saved !== null
        ? { before: saved.ctxBefore || '', after: saved.ctxAfter || '' }
        : null
      var best = null
      var bestScore = -1
      for (var i = 0; i < rows.length; i++) {
        var full = rows[i].textContent || ''
        var spans = allNormSpans(full, quote)
        for (var p = 0; p < spans.length; p++) {
          var range = rangeFromOffset(rows[i], spans[p].start, spans[p].end - spans[p].start)
          if (range === null) continue
          var score = ctxScore(full, spans[p].start, spans[p].end - spans[p].start, ctx)
          if (score > bestScore) { bestScore = score; best = range }
        }
      }
      if (best !== null && (ctx === null || bestScore > 0)) return best
      var flow = document.querySelector('[data-chat-flow]')
      if (flow === null) flow = document.querySelector('[data-focus-flow]')
      if (flow !== null) {
        var full2 = flow.textContent || ''
        var positions2 = allPositionsOf(flow, quote)
        var best2 = null
        var bestScore2 = -1
        for (var q2 = 0; q2 < positions2.length; q2++) {
          var range2 = rangeFromOffset(flow, positions2[q2], quote.length)
          if (range2 === null) continue
          var score2 = ctxScore(full2, positions2[q2], quote.length, ctx)
          if (score2 > bestScore2) { bestScore2 = score2; best2 = range2 }
        }
        if (best2 !== null && (ctx === null || bestScore2 > 0)) return best2
      }
      return null
    }

    function truncate(s, n) {
      return s.length > n ? s.slice(0, n) + '…' : s
    }

    function placeAbove(rect, height, width) {
      // 用实测宽度居中；硬编码 400 会把窄选区（双击选一个词）推到视口最左边。
      var w = width > 0 ? width : 96
      var left = rect.left + rect.width / 2 - w / 2
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
      // 下方优先：原生选中菜单（移动端长按菜单、桌面 Copy/Search 浮层）锚定在选区
      // 上沿附近，且原生 UI 恒绘制在页面内容之上（z-index 无效），工具条放上方必被
      // 遮挡；因此下方放得下就放下方，放不下才回上方。
      var belowTop = rect.bottom + 8
      var belowFits = belowTop + height <= window.innerHeight - 8
      var top
      if (belowFits) {
        top = belowTop
      } else {
        top = rect.top - height - 8
        if (top < 8) top = Math.min(rect.bottom + 8, window.innerHeight - height - 8)
      }
      return { left: Math.round(left), top: Math.round(Math.max(8, top)) }
    }

    /** 指针落点定位：工具条水平居中于「划选结束时鼠标停留位置」，
     *  竖直方向**恒定**落在光标下方（不再按划选方向翻上翻下）。
     *  width > 0 时用实测宽度；未知时用估算宽度（挂载后再校正一次）。
     *
     *  方向恒定是刻意的：旧实现按「光标在选区哪一半」决定贴上还是贴下，
     *  于是正向划选在下方、反向划选在上方，位置随方向跳变，每次都要重新找按钮。
     *  现在一律放下方，只有「光标贴近视口底部、下方确实放不下」时才翻到上方
     *  —— 那是物理必需，不随划选方向变化，日常使用中方向恒定。
     *
     *  代价：反向划选时光标停在选区上沿，下方就是刚选中的文字，按钮会压在上面。
     *  这是一致性的必然取舍（用户明确以「始终在下方」优先）。 */
    function placeForSelection(rect, point, height, width) {
      if (point === null) return placeAbove(rect, height, width)
      var w = width > 0 ? width : 96
      var left = point.x - w / 2
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8))
      var GAP = 8
      var maxTop = window.innerHeight - height - 8
      var top = point.y + GAP                 // 恒定：光标下方
      if (top > maxTop) {
        // 下方确实放不下（光标贴近视口底部）才翻到上方；与划选方向无关。
        top = point.y - height - GAP
        if (top < 8) top = maxTop
      }
      top = Math.max(8, Math.min(top, maxTop))
      return { left: Math.round(left), top: Math.round(top) }
    }

    function svg(paths, viewBox) {
      var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      s.setAttribute('viewBox', viewBox)
      s.setAttribute('fill', 'none')
      s.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      for (var i = 0; i < paths.length; i++) {
        var p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        p.setAttribute('d', paths[i])
        p.setAttribute('fill', 'currentColor')
        s.appendChild(p)
      }
      return s
    }
    var ICONS = {
      plus: function () {
        return svg(['M8.64453 1.5V7.34961H14.5V8.65039H8.64453V14.5H7.34473V8.65039H1.5V7.34961H7.34473V1.5H8.64453Z'], '0 0 16 16')
      },
      check: function () {
        return svg([
          'M15.0498 3.92579L8.49512 12.3818C8.25774 12.6881 8.04517 12.9645 7.84668 13.1689C7.63957 13.3823 7.38732 13.5841 7.04492 13.6719C6.86373 13.7183 6.6757 13.7346 6.48926 13.7197C6.13666 13.6915 5.8528 13.5355 5.6123 13.3604C5.38201 13.1926 5.12573 12.9567 4.83984 12.6953L1.03125 9.21289L1.96875 8.1875L5.77734 11.6699C6.08684 11.9529 6.27773 12.1249 6.43066 12.2363C6.50183 12.2882 6.54699 12.3135 6.57324 12.3252C6.58525 12.3305 6.59269 12.3322 6.5957 12.333C6.59802 12.3336 6.59961 12.334 6.59961 12.334C6.63317 12.3367 6.66758 12.3335 6.7002 12.3252C6.7002 12.3252 6.70211 12.3251 6.7041 12.3242C6.70698 12.3229 6.71348 12.319 6.72461 12.3115C6.74849 12.2956 6.78843 12.2642 6.84961 12.2012C6.98138 12.0654 7.13957 11.8628 7.39648 11.5313L13.9502 3.07422L15.0498 3.92579Z',
        ], '0 0 16 16')
      },
      close: function () {
        return svg([
          'M14.1168 13.197L13.197 14.1167L1.8833 2.80303L2.80309 1.88324L14.1168 13.197Z',
          'M13.197 1.88326L14.1168 2.80305L2.80309 14.1168L1.8833 13.197L13.197 1.88326Z',
        ], '0 0 16 16')
      },
      send: function () {
        return svg([
          'M8.3125 0.981587C8.66767 1.0545 8.97902 1.20558 9.2627 1.43374C9.48724 1.61438 9.73029 1.85933 9.97949 2.10854L14.707 6.83608L13.293 8.25014L9 3.95717V15.0431H7V3.95717L2.70703 8.25014L1.29297 6.83608L6.02051 2.10854C6.26971 1.85933 6.51277 1.61438 6.7373 1.43374C6.97662 1.24126 7.28445 1.04542 7.6875 0.981587C7.8973 0.94841 8.1031 0.956564 8.3125 0.981587Z',
        ], '0 0 16 16')
      },
      trash: function () {
        return svg([
          'M14.4782 4.84067L14.2138 10.1152C14.1102 12.1872 14.067 13.0115 13.3866 13.9607C13.1044 14.3546 12.7498 14.6912 12.3424 14.9535C11.8239 15.2872 11.2415 15.4316 10.5585 15.4998C9.88727 15.5668 9.04946 15.5656 7.99998 15.5656C6.95051 15.5656 6.1127 15.5668 5.44142 15.4998C4.75851 15.4316 4.17602 15.2872 3.65753 14.9535C3.25012 14.6912 2.89559 14.3546 2.61332 13.9607C1.93296 13.0115 1.88979 12.1872 1.78619 10.1152L1.52179 4.84067L2.89006 4.77277L3.15343 10.0463C3.26221 12.2218 3.32452 12.6015 3.72646 13.1624C3.90825 13.4161 4.13686 13.6334 4.39927 13.8023C4.66204 13.9714 5.00263 14.0792 5.57825 14.1367C6.16562 14.1953 6.92298 14.1963 7.99998 14.1963C9.07699 14.1963 9.83434 14.1953 10.4217 14.1367C10.9973 14.0792 11.3379 13.9714 11.6007 13.8023C11.8631 13.6334 12.0917 13.4161 12.2735 13.1624C12.6755 12.6015 12.7378 12.2218 12.8465 10.0463L13.1099 4.77277L14.4782 4.84067ZM5.43011 6.22849H6.7994V11.3909H5.43011V6.22849ZM9.20056 6.22849H10.5699V11.3909H9.20056V6.22849ZM8.53597 0.434431C9.17976 0.434431 9.6522 0.426926 10.0966 0.571258C10.2357 0.616451 10.3717 0.672554 10.502 0.738948C10.9182 0.951107 11.2464 1.29099 11.7015 1.74612L12.4978 2.54136H15.3742V3.91169H0.625732V2.54136H3.50218L4.29845 1.74612C4.75358 1.29099 5.08174 0.951107 5.49801 0.738948C5.62831 0.672554 5.76425 0.616451 5.90334 0.571258C6.34776 0.426926 6.82021 0.434431 7.46399 0.434431H8.53597ZM7.46399 1.80476C6.73208 1.80476 6.51641 1.81187 6.32617 1.87369C6.25545 1.89667 6.18668 1.92533 6.12041 1.95907C5.96398 2.03878 5.82348 2.16253 5.44142 2.54136H10.5585C10.1765 2.16253 10.036 2.03878 9.87955 1.95907C9.81329 1.92533 9.74452 1.89667 9.6738 1.87369C9.48356 1.81187 9.26789 1.80476 8.53597 1.80476H7.46399Z',
        ], '0 0 16 16')
      },
    }

    var PENDING_STORAGE_PREFIX = 'dsh.annotation.pending.v1.'

    function pendingStorageKey(sessionId) {
      return PENDING_STORAGE_PREFIX + encodeURIComponent(String(sessionId))
    }

    function parsePendingQuotes(raw) {
      if (typeof raw !== 'string' || raw === '') return []
      try {
        var value = JSON.parse(raw)
        if (!Array.isArray(value)) return []
        return value.filter(function (q) {
          return q !== null && typeof q === 'object'
            && typeof q.id === 'string' && typeof q.text === 'string' && q.text !== ''
        }).map(function (q) {
          return {
            id: q.id,
            text: q.text,
            note: typeof q.note === 'string' ? q.note : '',
            ...(typeof q.sourceUrl === 'string' && typeof q.sourcePath === 'string'
              ? { sourceUrl: q.sourceUrl, sourcePath: q.sourcePath } : {}),
            range: null,
            seqKey: typeof q.seqKey === 'string' ? q.seqKey : '',
            rowHead: typeof q.rowHead === 'string' ? q.rowHead : '',
            textOffset: Number.isFinite(q.textOffset) ? q.textOffset : -1,
            ctxBefore: typeof q.ctxBefore === 'string' ? q.ctxBefore : '',
            ctxAfter: typeof q.ctxAfter === 'string' ? q.ctxAfter : '',
          }
        })
      } catch (_) {
        return []
      }
    }

    function stringifyPendingQuotes(quotes) {
      return JSON.stringify(quotes.map(function (q) {
        return {
          id: q.id,
          text: q.text,
          note: q.note || '',
          ...(q.sourceUrl ? { sourceUrl: q.sourceUrl, sourcePath: q.sourcePath } : {}),
          seqKey: q.seqKey || '',
          rowHead: q.rowHead || '',
          textOffset: Number.isFinite(q.textOffset) ? q.textOffset : -1,
          ctxBefore: q.ctxBefore || '',
          ctxAfter: q.ctxAfter || '',
        }
      }))
    }

    // ============================== 插件主体 ==============================
    function apply(ctx) {
      // 重复 apply 防护（fiber 重载 / 热重载兜底）：先撤销上一实例，避免双份
      // 文档级监听与双份浮层——双份会把批注块拼进草稿两次。
      // 实例注册表：teardown 是单槽引用，会被后一实例覆盖，导致前一实例的浮层
      // 永久残留（= 屏幕上两个「批注」按钮）。这里逐个撤销所有历史实例。
      // 挂在 window 上，不同 bundle 副本（各自模块作用域）也能共享。
      var INSTANCE_REGISTRY = '__dshAnnotationInstances'
      try {
        var registry = window[INSTANCE_REGISTRY]
        if (!Array.isArray(registry)) { registry = []; window[INSTANCE_REGISTRY] = registry }
        for (var ri = 0; ri < registry.length; ri++) {
          try { registry[ri]() } catch (_) {}
        }
        registry.length = 0
      } catch (_) {}
      try {
        if (typeof window.__dshAnnotationTeardown === 'function') window.__dshAnnotationTeardown()
      } catch (_) {}

      /** 按选择器清掉「不是本实例」的浮层：兜底注册表管不到的历史遗留实例
       *  （例如由本补丁之前的旧 bundle 创建的 host / overlay）。 */
      function sweepStrayLayers() {
        try {
          var hosts = document.querySelectorAll('[data-annotation-for-dsh]')
          for (var i = 0; i < hosts.length; i++) {
            if (hosts[i] !== host) hosts[i].remove()
          }
          var ovs = document.querySelectorAll('[data-annotation-overlay]')
          for (var j = 0; j < ovs.length; j++) {
            if (ovs[j] !== overlay) ovs[j].remove()
          }
        } catch (_) {}
      }

      // ---------- 服务惰性解析（修复 cannot get required service ... in inactive context）----------
      // 插件 ctx 所属 fiber 在「会话作用域重新物化 / 服务重注册 / 插件热重载」窗口内
      // 会进入 inactive；此时读注入服务，cordis 反射 handler 直接抛
      //   cannot get required service "conversation" in inactive context
      // （cordis/lib/index.js 反射 get：prop 命中 fiber.inject 但 fiber.store 无实现即抛）。
      // 因此任何一次使用都重新解析、失败即回退，绝不缓存服务对象，绝不让批注静默丢失。
      var sessionsFallback = null
      try { sessionsFallback = ctx.sessions } catch (_) { sessionsFallback = null }

      function sessionsSvc() {
        try {
          var s = ctx.sessions
          if (s !== undefined && s !== null && typeof s.scope === 'function') return s
        } catch (_) {}
        return sessionsFallback
      }

      function conversationSvc() {
        try {
          var svc = ctx.conversation
          if (svc !== undefined && svc !== null && svc.input !== undefined) return svc
        } catch (_) {}
        return null
      }

      /** 安全解析会话作用域；服务不可用或未保留该会话时返回 undefined。 */
      function scopeOfSession(id) {
        if (id === undefined || id === null) return undefined
        var s = sessionsSvc()
        if (s === null || typeof s.scope !== 'function') return undefined
        try {
          var sc = s.scope(id)
          return sc === undefined ? undefined : sc
        } catch (_) {
          return undefined
        }
      }

      /** 解析会话输入 shell；服务 inactive 或作用域未物化时返回 null（调用方回退 DOM）。 */
      function shellFor(scoped) {
        if (scoped === undefined || scoped === null) return null
        var svc = conversationSvc()
        if (svc === null) return null
        try {
          var sh = svc.input.for(scoped)
          if (sh !== undefined && sh !== null && sh.state !== undefined) return sh
        } catch (_) {}
        return null
      }

      function composerInputEl() {
        var el = document.querySelector('[data-composer-card] [data-composer-input]')
        return el instanceof HTMLElement && el.isContentEditable ? el : null
      }

      function domDraftText() {
        var el = composerInputEl()
        return el === null ? '' : (el.innerText || el.textContent || '')
      }

      /** DOM 回退：把批注块 prepend 进可编辑输入区（光标置首后 insertText）。
       *  走宿主编辑机自己的输入通道，随后宿主自己的 Enter / 发送按钮提交，批注不丢。 */
      function domAttachBlock(block, hasQuestion) {
        var el = composerInputEl()
        if (el === null) return false
        try {
          el.focus({ preventScroll: true })
          var sel = window.getSelection()
          if (sel === null) return false
          sel.selectAllChildren(el)
          sel.collapseToStart()
          var ok = document.execCommand('insertText', false, block + (hasQuestion ? '\n' : ''))
          return ok !== false
        } catch (_) {
          return false
        }
      }

      function currentSessionId() {
        try {
          var raw = localStorage.getItem("dsh.sessions.current")
          if (raw) { var j = JSON.parse(raw); if (j && j.sessionId) return j.sessionId }
        } catch (_) {}
        return null
      }

      var host = document.createElement('div')
      host.setAttribute('data-annotation-for-dsh', '')
      document.body.appendChild(host)
      var overlay = document.createElement('div')
      overlay.setAttribute('data-annotation-overlay', '')
      overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:900;'
      document.body.appendChild(overlay)
      // host / overlay 已绑定本实例：此刻任何其它同选择器元素都是残留。
      sweepStrayLayers()

      var ui = {
        mode: 'closed',      // closed | actions | editing | composing
        editingId: null,     // 非空 = 正在编辑该 id 的已有批注（点角标进入）
        quote: '',
        quotes: [],          // [{ id, text, note, range, seqKey, rowHead, textOffset, ctxBefore, ctxAfter }]
        noteDraft: '',
        pos: { left: 0, top: 0 },
        error: null,
        busy: false,
        lastKey: '',
        pendingAnchor: null,
        el: null,
        anchorRel: null,     // 指针落点相对选区矩形的偏移（跟随滚动 / 重排）
        anchorPoint: null,   // 本次落位使用的指针视口坐标（null = 键盘 / 双击划选）
        anchorRect: null,    // 本次落位使用的选区矩形（宽度实测后重排用）
        barWidth: 0,         // 上次实测的工具条宽度
      }

      function readPendingQuotes(sessionId) {
        if (sessionId === undefined) return []
        try {
          return parsePendingQuotes(localStorage.getItem(pendingStorageKey(sessionId)))
        } catch (err) {
          console.warn('[annotation] 读取待发送批注失败：', err)
          return []
        }
      }

      function writePendingQuotes(sessionId) {
        if (sessionId === undefined) return
        try {
          var key = pendingStorageKey(sessionId)
          if (ui.quotes.length === 0) localStorage.removeItem(key)
          else localStorage.setItem(key, stringifyPendingQuotes(ui.quotes))
        } catch (err) {
          console.warn('[annotation] 保存待发送批注失败：', err)
        }
      }

      function writeCurrentPendingQuotes() {
        writePendingQuotes(currentSessionId())
      }

      var ignoreUntil = 0
      var settleTimer = null

      // ---------- IME 合成 latch（对齐官方 InputBar composingRef）----------
      // macOS / 豆包等：compositionend 之后才会到 keydown(Enter, isComposing=false,
      // keyCode=13)，仅查 isComposing / 229 挡不住「上屏确认 Enter」。若此时
      // attachAndSend → setDraft，会打断合成，表现为只能打出拼音字母。
      // 延迟清 latch 与 InputBar 一致（略放宽到 50ms，兼容第三方输入法时序）。
      var imeComposing = false
      var imeClearTimer = null
      var imeTouchedAt = 0
      function markImeComposing() {
        imeComposing = true
        imeTouchedAt = Date.now()
        if (imeClearTimer !== null) {
          clearTimeout(imeClearTimer)
          imeClearTimer = null
        }
      }
      function markImeEnded() {
        if (imeClearTimer !== null) clearTimeout(imeClearTimer)
        imeClearTimer = setTimeout(function () {
          imeComposing = false
          imeClearTimer = null
        }, 50)
      }
      /** @param {KeyboardEvent} e */
      function isImeKeyBlocked(e) {
        if (e.isComposing === true || e.keyCode === 229) {
          imeTouchedAt = Date.now()
          return true
        }
        // compositionend 偶尔会丢失。只在浏览器已明确报告「非合成」且 latch
        // 1.2 秒没有活动时复位，避免一次异常把之后所有 Enter 永久锁死。
        if (imeComposing && imeClearTimer === null && Date.now() - imeTouchedAt >= 1200) {
          imeComposing = false
        }
        return imeComposing
      }
      document.addEventListener('compositionstart', markImeComposing, true)
      document.addEventListener('compositionend', markImeEnded, true)

      // ---------- 轻提示 ----------
      var toastTimer = null
      function showToast(msg) {
        try {
          var old = document.querySelector('[data-annotation-toast]')
          if (old !== null) old.remove()
          var el = document.createElement('div')
          el.setAttribute('data-annotation-toast', '')
          el.textContent = msg
          el.style.cssText = 'position:fixed;z-index:1300;left:50%;bottom:88px;transform:translateX(-50%);max-width:min(420px,calc(100vw - 24px));padding:8px 14px;border-radius:10px;background:var(--dsh-ann-surface,#2c2c2e);border:1px solid var(--dsh-ann-border,rgba(0,0,0,.12));box-shadow:var(--dsw-shadow-lv2);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family,system-ui);font-size:12px;pointer-events:none;'
          document.body.appendChild(el)
          if (toastTimer !== null) clearTimeout(toastTimer)
          toastTimer = setTimeout(function () {
            toastTimer = null
            if (el.parentNode) el.parentNode.removeChild(el)
          }, 3000)
        } catch (_) { /* toast 失败忽略 */ }
      }

      // ---------- 指针落点追踪（工具条贴「划选结束时鼠标位置」的下方）----------
      // 指针坐标是视口坐标，只在「本次划选手势刚结束」的短窗口内可信：
      // 拖动中持续跟随（buttons 非 0），松开后仍跟随一小段时间，取「最后鼠标位置」。
      // 键盘 / 双击划选没有拖动轨迹 → trusted 保持 false，回退选区矩形定位。
      var pointer = { x: 0, y: 0, t: 0, dragging: false, dragged: false, trusted: false }
      var POINTER_TRUST_MS = 1500

      function notePointer(e) {
        pointer.x = e.clientX
        pointer.y = e.clientY
        pointer.t = Date.now()
      }

      function onPointerDownTrack(e) {
        if (e.button !== 0) return
        pointer.dragging = true
        pointer.dragged = false
        pointer.trusted = false
        notePointer(e)
      }

      function onPointerMoveTrack(e) {
        if (pointer.dragging) {
          if (e.buttons !== 0) {
            pointer.dragged = true
            // 确认是真实拖动就立即置可信：不再只在 pointerup 才置位。
            // 否则「在窗口外松开」时收不到 pointerup，trusted 永远为 false，
            // 工具条会退回「居中于选区」。
            pointer.trusted = true
            notePointer(e)
          }
          return
        }
        // 松开后到 settle 落位之间的移动也跟随（真正取「最后鼠标位置」）。
        if (pointer.trusted) notePointer(e)
      }

      function onPointerUpTrack(e) {
        if (e.button !== 0) return
        if (pointer.dragging) {
          notePointer(e)
          pointer.trusted = pointer.dragged
        }
        pointer.dragging = false
      }

      document.addEventListener('pointerdown', onPointerDownTrack, true)
      document.addEventListener('pointermove', onPointerMoveTrack, true)
      document.addEventListener('pointerup', onPointerUpTrack, true)
      // 触控 / 系统手势打断时没有 pointerup，用 cancel 收尾（trusted 已在移动中置位）。
      document.addEventListener('pointercancel', onPointerUpTrack, true)

      /** 当前可信的指针落点；不可信（无拖动 / 已过期）时返回 null。
       *  越界不再丢弃而是钳到最近边缘：拖动划选时鼠标常会越出视口
       *  （贴右边缘、拖到窗口外），此时应把工具条贴到对应边缘，
       *  而不是整个丢掉指针锚点、退回「居中于选区」。 */
      function livePointer() {
        if (!pointer.trusted) return null
        if (Date.now() - pointer.t > POINTER_TRUST_MS) return null
        var x = Math.max(0, Math.min(pointer.x, window.innerWidth))
        var y = Math.max(0, Math.min(pointer.y, window.innerHeight))
        return { x: x, y: y }
      }

      // ---------- 选区监听 ----------
      function selectionKey(sel) {
        if (sel === null || sel.rangeCount === 0) return ''
        var r = sel.getRangeAt(0)
        return String(r.startContainer === r.endContainer ? 1 : 0)
          + ':' + r.startOffset + ':' + r.endOffset + ':' + sel.toString().length
      }

      function onSelection() {
        if (ui.mode !== 'closed' && host.childNodes.length === 0) {
          ui.mode = 'closed'
          ui.lastKey = ''
        }
        if (ui.mode === 'editing' || ui.mode === 'composing' || ignoreUntil > Date.now()) return
        var sel = window.getSelection()
        if (sel === null || sel.isCollapsed || sel.rangeCount === 0) {
          clearSettle()
          return
        }
        var range = sel.getRangeAt(0)
        var anc = range.commonAncestorContainer
        var ancEl = anc instanceof Element ? anc : (anc && anc.parentElement)
        if (ancEl !== null && ancEl.closest) {
          if (ancEl.closest('[data-annotation-for-dsh]') || ancEl.closest('[data-annotation-overlay]')
            || ancEl.closest('[data-composer-card]') || ancEl.closest('[data-input-scroll]')) {
            clearSettle()
            return
          }
        }
        if (host.contains(anc) || overlay.contains(anc)) {
          clearSettle()
          return
        }
        var text = sel.toString().trim()
        if (text.length === 0) { clearSettle(); return }
        var key = selectionKey(sel)
        var rootEl = annotationRootOf(range.commonAncestorContainer)
        var source = documentSourceOf(range.commonAncestorContainer)
        if (source !== null && source.sessionId !== currentSessionId()) rootEl = null
        if (rootEl === null) { clearSettle(); closeToolbar(); return }
        if (ui.mode === 'actions' && key === ui.lastKey && text === ui.quote && rootEl === ui.selectionRoot
          && (ui.source && ui.source.sourceUrl) === (source && source.sourceUrl)) { clearSettle(); return }
        clearSettle()
        settleTimer = setTimeout(function () {
          settleTimer = null
          if (ui.mode === 'editing' || ui.mode === 'composing') return
          var s = window.getSelection()
          if (s === null || s.isCollapsed || selectionKey(s) !== key) return
          var r = s.getRangeAt(0)
          if (annotationRootOf(r.commonAncestorContainer) !== rootEl) return
          var currentSource = documentSourceOf(r.commonAncestorContainer)
          if ((currentSource && currentSource.sourceUrl) !== (source && source.sourceUrl)
            || (source !== null && source.sessionId !== currentSessionId())) return
          var rect = r.getBoundingClientRect()
          if (rect.width === 0 || rect.height === 0) return
          var point = livePointer()
          var p = placeForSelection(rect, point, 40, ui.barWidth)
          ui.anchorPoint = point
          ui.anchorRect = rect
          ui.anchorRel = point === null ? null : { rx: point.x - rect.left, ry: point.y - rect.bottom }
          if (ui.mode === 'actions' && ui.quote === text && (ui.source && ui.source.sourceUrl) === (source && source.sourceUrl)) {
            ui.lastKey = key
            ui.pos = p
            if (ui.el !== null && ui.el.style) {
              ui.el.style.left = p.left + 'px'
              ui.el.style.top = p.top + 'px'
            }
            return
          }
          ui.lastKey = key
          ui.mode = 'actions'
          ui.quote = text
          ui.source = source
          ui.selectionRoot = rootEl
          ui.error = null
          ui.pos = p
          render()
        }, 250)
      }
      document.addEventListener('selectionchange', onSelection)

      function clearSettle() {
        if (settleTimer !== null) { clearTimeout(settleTimer); settleTimer = null }
      }

      function onHostPointerDown() { ignoreUntil = Date.now() + 80 }
      host.addEventListener('pointerdown', onHostPointerDown)

      function onDocPointerDown(e) {
        if (ui.mode === 'actions' && !host.contains(e.target) && !overlay.contains(e.target)) {
          closeToolbar()
        }
      }
      document.addEventListener('pointerdown', onDocPointerDown, true)

      var anchorRaf = false
      var lostSince = 0
      var ANCHOR_LOST_MS = 1000
      function onLayoutChange() {
        if (anchorRaf) return
        anchorRaf = true
        requestAnimationFrame(function () {
          anchorRaf = false
          if (ui.quotes.length > 0) renderMarkers()
          updateChip()
          if (ui.mode === 'editing' && ui.el !== null) positionEditor(ui.el, ui.pos.left, ui.pos.top)
          if (ui.mode !== 'actions' || ui.quote === '') return
          var rect = null
          var sel = window.getSelection()
          if (sel !== null && !sel.isCollapsed && sel.rangeCount > 0) {
            var live = sel.getRangeAt(0)
            if (annotationRootOf(live.commonAncestorContainer) === ui.selectionRoot
              && (documentSourceOf(live.commonAncestorContainer)?.sourceUrl || '') === (ui.source && ui.source.sourceUrl || '')
              && sel.toString().trim() === ui.quote) {
              rect = live.getBoundingClientRect()
            }
          }
          if (rect === null) {
            var range = locateQuote(ui.quote, ui.source)
            if (range !== null) rect = range.getBoundingClientRect()
          }
          if (rect === null || rect.width === 0 || rect.height === 0) {
            if (lostSince === 0) lostSince = Date.now()
            if (Date.now() - lostSince > ANCHOR_LOST_MS) { lostSince = 0; closeToolbar() }
            return
          }
          lostSince = 0
          // 有指针锚点时按「相对选区矩形的偏移」重算：滚动 / 重排后工具条仍
          // 停在选区下沿的同一相对位置，不会跳回矩形居中。
          var p = ui.anchorRel === null
            ? placeAbove(rect, 40, ui.barWidth)
            : placeForSelection(rect, {
              x: rect.left + ui.anchorRel.rx,
              y: rect.bottom + ui.anchorRel.ry,
            }, 40, ui.barWidth)
          ui.anchorRect = rect
          if (Math.abs(p.left - ui.pos.left) + Math.abs(p.top - ui.pos.top) > 2) {
            ui.pos = p
            if (ui.el !== null && ui.el.style) {
              ui.el.style.left = p.left + 'px'
              ui.el.style.top = p.top + 'px'
            } else {
              render()
            }
          }
        })
      }
      window.addEventListener('scroll', onLayoutChange, true)
      window.addEventListener('resize', onLayoutChange)

      function mutationRelevant(mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var t = mutations[i].target
          var el = t instanceof Element ? t : (t && t.parentElement)
          if (el === null || !el.closest) return true
          if (el.closest('[data-composer-card]') || el.closest('[data-input-scroll]')
            || el.closest('[data-annotation-for-dsh]') || el.closest('[data-annotation-overlay]')
            || el.closest('[data-annotation-chip]') || el.closest('[data-annotation-tip-layer]')) {
            continue
          }
          return true
        }
        return false
      }
      // 「刚发出、正等着新气泡出现」的窗口。为什么需要它：
      // v1.4.3 的优化假设「行插入批次本身就携带完整批注块」，所以只在含 childList 的批次里
      // 同步跑 decorateAll，其余批次只触发 500ms 限流的助手扫描。这个前提对**刚发出的用户
      // 消息**不成立——它的文本可能到后续批次才落进 DOM（React 的 commitTextUpdate 直接写
      // 已有文本节点 → characterData 批次），也可能在隐藏之后被整行重渲染覆盖回来。两种
      // 情况都会让批注块先被画出来（用户看到「原文一闪而过」），要等 500ms/1s 才隐藏。
      //
      // v1.4.23 在这里犯过一个错：窗口「第一次隐藏成功就收起」。结果隐藏完的下一帧被 React
      // 重渲染覆盖回去时窗口已经关了，闪烁照旧。现在窗口按时间过期，靠
      // freshBubbleNeedsHide() 这个 O(1) 判据决定要不要跑全量扫描——流式文本里没有批注块，
      // 所以窗口开着也不会把 v1.4.3 省下的开销还回去。
      var freshBubbleUntil = 0
      var FRESH_BUBBLE_WINDOW = 2000
      function markFreshBubble() { freshBubbleUntil = Date.now() + FRESH_BUBBLE_WINDOW }
      function awaitingFreshBubble() { return Date.now() < freshBubbleUntil }
      function settleFreshBubble() { freshBubbleUntil = 0 }

      /** 窗口内的廉价补刀判据：最新一行气泡、或队列 dock 的提交回显行里，又出现批注块了？
       *  只看最新一行（+ 通常 0~1 个回显行），所以可以每个批次都问一次。 */
      function freshBubbleNeedsHide() {
        var rows = allMessageRows()
        if (rows.length > 0) {
          var el = rows[rows.length - 1]
          if (el.querySelector('[data-annotation-bubble-tag]') === null) {
            var b = el.querySelector('[class*="bubble"]')
            if (b !== null && hasAnnotationBlock(b.textContent || '')) return true
          }
        }
        var echoes = document.querySelectorAll('[data-submission-echo]')
        for (var i = 0; i < echoes.length; i++) {
          if (hasAnnotationBlock(echoes[i].textContent || '')) return true
        }
        return false
      }

      var observer = new MutationObserver(function (mutations) {
        if (!mutationRelevant(mutations)) return
        onLayoutChange()
        // 「消息行插入」批次同步执行气泡装饰（隐藏批注块 + 贴标签）：
        // MutationObserver 回调在微任务阶段运行，早于浏览器绘制，
        // 用户看不到「先显示批注块再隐藏」的闪烁。
        // 另外，刚发出消息的短窗口内（awaitingFreshBubble）任何相关批次也同步执行——
        // 气泡文本可能由 characterData 批次写入，只认 childList 会漏掉它。
        // 流式输出期的主体 mutation 是 attributes/characterData（每个 token 帧一层
        // class/style/文本变更，实测 20s 内 245 批次 0 个 childList）：行插入本来
        // 就携带完整批注块，逐一触发全文档扫描（decorateAll 是 querySelectorAll +
        // 每行子树查询 + textContent，成本随会话长度线性增长）会在长会话上白白
        // 烧主线程；漏网场景由下方 1s 兜底轮询覆盖。
        var hasRowInsert = false
        for (var i = 0; i < mutations.length; i++) {
          if (mutations[i].type === 'childList') { hasRowInsert = true; break }
        }
        if (hasRowInsert || (awaitingFreshBubble() && freshBubbleNeedsHide())) {
          decorateAll()
          return
        }
        // 流式批次: 只做助手回复芯片的限流装饰(行内 data-streaming 守卫已保证
        // 流式中不做替换, 结束后的首拍芯片滞后 ≤500ms), 不再逐批全文档扫描。
        scheduleAssistantDecorate()
      })
      observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true })

      function onKeyDown(e) {
        if (e.key === 'Escape') {
          if (ui.mode !== 'closed') closeToolbar()
          return
        }
        // 【回车随输入框发送】在 composer 里按 Enter（且已收集批注、非输入法合成）：
        // 提交前一刻把批注块拼进草稿，composer 自己的 Enter 提交继续——模型收到
        // 批注清单 + 用户输入的问题。用户始终看不到文本被塞进去。
        // IME 铁律（v1.3.10 修了 nativeEvent.keyCode；v1.3.11 补 compositionend
        // 后 Enter keyCode=13 的时序洞）：合成期 / 上屏确认 Enter 绝不能 setDraft。
        // 修饰键守卫（v1.3.18 修 issue #10）：Shift+Enter 换行、Alt+Enter 默认路径
        // 不触发拼稿；裸 Enter 继续处理带文字草稿，Cmd/Ctrl+Enter 只接管空草稿
        // 的纯批注。已有文字时交回 composer，保留宿主的 Queue / Steer 策略。
        // 纯批注的 Cmd/Ctrl+Enter 需要在这里直接提交：composer 的 accelerated 路径在
        // 「运行中 + 有排队消息」时会走 steerQueue，而不是发送当前草稿；我们在
        // capture 阶段 setDraft 后 stopPropagation，主动 submit('queue')，保证
        // 纯批注能直接发出，同时不会把批注块明文留在输入框。
        if (e.key === 'Enter' && !e.shiftKey && !e.altKey
          && ui.quotes.length > 0 && !isImeKeyBlocked(e)) {
          var input = e.target instanceof Element && e.target.closest('[data-composer-input]')
          if (input !== null && input.closest('[data-composer-card]') !== null) {
            var attached = attachAndSend(e)
            if (attached && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              e.stopPropagation()
              submitAttached()
            }
          }
        }
      }
      // capture 阶段：必须先于 composer 自己的 Enter 处理（React 在容器层冒泡
      // 提交）——否则等我们执行时消息已提交，拼稿永远太迟。
      document.addEventListener('keydown', onKeyDown, true)

      /** DOM 回退下的提交：服务可用走 submit('queue')，否则向输入区派发合成 Enter，
       *  由宿主自己的键位表提交（我们 capture 阶段的 onKeyDown 已幂等，不会重复拼块）。 */
      function submitAttached() {
        var current = currentSessionId()
        var shell = shellFor(scopeOfSession(current))
        if (shell !== null) {
          try {
            shell.submit('queue')
            return
          } catch (err) {
            console.warn('[annotation] 批注直接提交失败，回退合成 Enter：', err)
          }
        }
        var el = composerInputEl()
        if (el === null) return
        try {
          el.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
            bubbles: true, cancelable: true,
          }))
        } catch (err) {
          console.warn('[annotation] 合成 Enter 提交失败：', err)
        }
      }

      function sendButtonOf(target) {
        if (!(target instanceof Element) || typeof target.closest !== 'function') return null
        var button = target.closest('button')
        if (!(button instanceof HTMLButtonElement)
          || button.closest('[data-composer-card]') === null) return null
        var label = button.getAttribute('aria-label')
        return label === '发送消息' || label === 'Send message' ? button : null
      }

      // 宿主的发送按钮在草稿为空时是 disabled 的
      // （dsh-client-ui-conversation/lib/client.js：
      //    empty = draft.trim() === '' && attachments.length === 0
      //    primaryDisabled = primaryStops ? stop === undefined : empty || disabled || machineBusy || uploadsPending）
      // 而浏览器**不会给 disabled 的表单控件派发 pointer/mouse 事件**——所以
      // 「监听按钮上的 pointerdown」这条路永远等不到事件。v1.4.20 及之前就是这么写的，
      // 注释里「pointerdown 能覆盖禁用的发送按钮」的假设是错的，表现为
      // 「有批注但草稿为空时，必须先随便打点字才能点发送」。
      // v1.4.21 改为：有批注待发送且草稿为空时主动摘掉 disabled（视觉与功能一致地变为
      // 可用），并在 capture 阶段接管 click，走插件自己的纯批注提交路径。
      var sendBtnState = { el: null }

      /** composer 的草稿文本是否为空（服务不可用时也能读）。 */
      function draftIsEmpty() {
        var el = composerInputEl()
        if (el === null) return false
        var text = el.isContentEditable ? el.textContent : el.value
        return (text || '').trim() === ''
      }

      /** 是否是宿主那个「普通发送」按钮（运行中的停止 / 排队 / 插话按钮都不算）。 */
      function isPlainSendButton(button) {
        var label = button.getAttribute('aria-label')
        return label === '发送消息' || label === 'Send message'
      }

      /** composer 里是否已经有附件。附件条的 group aria-label 只在有附件时才渲染
       *  （dsh-client-ui-attachment: railItems.length > 0 && <AttachmentRail>，
       *   labels.group = t("attachment.pending")）。
       *  有附件时宿主的 empty 不成立（empty = 草稿空 && 无附件），按钮仍被禁用就只可能是
       *  「附件还在上传」（uploadsPending）——那种情况不接管，免得绕过宿主的守卫。 */
      function hasAttachments() {
        return document.querySelector(
          '[data-composer-card] [aria-label="待发送附件"],'
          + '[data-composer-card] [aria-label="Pending attachments"]') !== null
      }

      // 我们刚提交过、还在等宿主结算的窗口：这期间不重新接管按钮。宿主靠
      // primaryDisabled 里的 machineBusy 达到同样目的，而我们摘掉了 disabled，必须自己补上
      // 这道闸——否则双击的第二下会在提交途中再喂一次 enter（宿主的 submit(mode) 不幂等，
      // mode="queue" 会把第二条排进队列）。
      var sendInFlight = false
      var sendInFlightSince = 0
      var SEND_IN_FLIGHT_TIMEOUT = 5000

      function sendStillInFlight() {
        if (!sendInFlight) return false
        // 结算完成的信号：待发送批注已被消费；或用户又开始输入（按钮交回宿主）；
        // 或兜底超时，避免任何异常路径把它永久卡住。
        if (ui.quotes.length === 0 || !draftIsEmpty()
          || Date.now() - sendInFlightSince > SEND_IN_FLIGHT_TIMEOUT) {
          sendInFlight = false
        }
        return sendInFlight
      }

      /** 只接管「空草稿的纯批注」这一种情况：
       *  - 有批注待发送，且上一次从按钮发出的批注已经结算完（sendStillInFlight）；
       *  - 按钮仍是宿主的普通发送按钮（运行中的停止 / 排队 / 插话按钮一律不碰）；
       *  - 草稿为空；
       *  - 输入区没有被宿主置为不可编辑（会话只读 / 父会话离线时 aria-disabled="true"）；
       *  - 没有附件（有附件时按钮被禁用的原因不是 empty，而是附件还在上传）。 */
      function canOwnSendButton(button) {
        if (ui.quotes.length === 0) return false
        if (sendStillInFlight()) return false
        if (!isPlainSendButton(button)) return false
        var input = composerInputEl()
        if (input !== null && input.getAttribute('aria-disabled') === 'true') return false
        if (hasAttachments()) return false
        return draftIsEmpty()
      }

      /** 条件满足时让发送按钮可用；条件消失后把 disabled 还回去。 */
      function syncSendButton() {
        var button = document.querySelector(
          '[data-composer-card] button[aria-label="发送消息"],'
          + '[data-composer-card] button[aria-label="Send message"]')
        if (button === null) {
          sendBtnState.el = null
          return
        }
        if (canOwnSendButton(button)) {
          sendBtnState.el = button
          if (button.disabled) {
            button.disabled = false
            button.setAttribute('data-dsh-ann-enabled', '1')
          }
          return
        }
        var prev = sendBtnState.el
        sendBtnState.el = null
        if (prev === null || !prev.isConnected) return
        if (prev.getAttribute('data-dsh-ann-enabled') !== '1') return
        prev.removeAttribute('data-dsh-ann-enabled')
        // 只有「草稿仍是空的」且「按钮仍是普通发送按钮」才把 disabled 还回去：
        // 用户若在这期间输入了文字，宿主自己已把按钮恢复为可用；而运行中按钮会变成停止
        // 按钮，那时把 disabled 设回去会把「停止」点不了。
        if (draftIsEmpty() && isPlainSendButton(prev)) prev.disabled = true
      }

      /** 卸载时把按钮还回宿主，否则插件停用后按钮会留在「看起来可用、点了没反应」的状态。 */
      function releaseSendButton() {
        var prev = sendBtnState.el
        sendBtnState.el = null
        sendInFlight = false
        if (prev === null || !prev.isConnected) return
        if (prev.getAttribute('data-dsh-ann-enabled') !== '1') return
        prev.removeAttribute('data-dsh-ann-enabled')
        if (draftIsEmpty() && isPlainSendButton(prev)) prev.disabled = true
      }

      /** 按钮激活（鼠标 / 触控 / 辅助技术都会产生 click）：宿主自己会因为 empty 而
       *  拒绝提交（onPrimary 里 `if (!empty && !disabled && !machineBusy && !uploadsPending)`），
       *  所以这里在 capture 阶段接管，不把事件交给宿主的 onClick。 */
      function onSendButtonActivate(e) {
        if (ui.quotes.length === 0 || e.button !== 0) return
        var button = sendButtonOf(e.target)
        if (button === null || button.getAttribute('data-dsh-ann-enabled') !== '1') return
        e.preventDefault()
        e.stopPropagation()
        if (!attachAndSend({ ctrlKey: false, metaKey: false })) return
        // 立刻上闸：从这一刻到 pending 被消费之间不再重新接管按钮（见 sendStillInFlight）。
        sendInFlight = true
        sendInFlightSince = Date.now()
        var shell = shellFor(scopeOfSession(currentSessionId()))
        if (shell === null) { submitAttached(); return }
        try {
          shell.submit('queue')
        } catch (err) {
          // 宿主同步抛错时如实告知，不假装成功。异步失败由宿主自己的错误通知呈现
          // （例如附件未上传完：sendSession / serializeDraftAttachments 抛错后经
          //   notify("error", …) 显示），这里只兜同步抛出的情况。
          console.warn('[annotation] 批注提交被宿主拒绝：', err)
          showToast(t('toast.sendBlocked') + (err && err.message ? err.message : err))
        }
      }
      document.addEventListener('click', onSendButtonActivate, true)

      // 宿主重渲染可能把 disabled 写回来、或整个按钮换掉：属性观察 + 周期扫描双兜底。
      var sendBtnObserver = null
      if (typeof MutationObserver === 'function') {
        sendBtnObserver = new MutationObserver(function () { syncSendButton() })
        sendBtnObserver.observe(document.documentElement,
          { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'aria-label'] })
      }
      syncSendButton()

      // ---------- 渲染 ----------
      function iconButton(cls, icon, title, onClick) {
        var b = document.createElement('button')
        b.type = 'button'
        b.className = cls
        b.title = title
        b.appendChild(icon())
        b.addEventListener('click', function () { ignoreUntil = Date.now() + 80; onClick() })
        return b
      }

      function ghostButton(icon, label, title, disabled, onClick) {
        var b = document.createElement('button')
        b.type = 'button'
        b.className = 'dsh-ann-ghost'
        b.title = title
        if (icon !== null) b.appendChild(icon())
        b.appendChild(document.createTextNode(label))
        b.disabled = disabled === true
        b.addEventListener('click', function () { ignoreUntil = Date.now() + 80; onClick() })
        return b
      }

      function render() {
        host.textContent = ''
        ui.el = null
        if (ui.mode === 'actions') {
          var bar = document.createElement('div')
          bar.className = 'dsh-ann-bar'
          bar.style.left = ui.pos.left + 'px'
          bar.style.top = ui.pos.top + 'px'
          var already = ui.quotes.some(function (q) { return q.text === ui.quote && (q.sourceUrl || '') === (ui.source && ui.source.sourceUrl || '') })
          bar.appendChild(ghostButton(
            already ? null : ICONS.plus,
            already ? t('actions.already') : t('actions.annotate'),
            already ? t('actions.alreadyTitle') : t('actions.annotateTitle'),
            already,
            enterEditing,
          ))
          host.appendChild(bar)
          ui.el = bar
          // 指针定位要真实宽度才能水平居中；首帧用估算宽度会偏半个工具条，
          // 挂载后立刻按实测宽度重排一次（同帧内完成，无可见抖动）。
          if (ui.anchorRect !== null && bar.offsetWidth > 0) {
            ui.barWidth = bar.offsetWidth
            var fit = placeForSelection(ui.anchorRect, ui.anchorPoint, bar.offsetHeight || 36, ui.barWidth)
            ui.pos = fit
            bar.style.left = fit.left + 'px'
            bar.style.top = fit.top + 'px'
          }
        } else if (ui.mode === 'editing') {
          var card = document.createElement('div')
          card.className = 'dsh-ann-card'
          card.style.left = ui.pos.left + 'px'
          card.style.top = ui.pos.top + 'px'
          ui.el = card
          var head = document.createElement('div')
          head.className = 'dsh-ann-card-head'
          makeEditorDraggable(head, card)
          var title = document.createElement('div')
          title.className = 'dsh-ann-card-title'
          title.textContent = ui.editingId !== null ? t('edit.editTitle') : t('edit.addTitle')
          head.appendChild(title)
          head.appendChild(iconButton('dsh-ann-icon', ICONS.close, t('common.cancel'), closeToolbar))
          card.appendChild(head)
          var quote = document.createElement('div')
          quote.className = 'dsh-ann-quote'
          quote.textContent = truncate(quoteWithSource({ text: ui.quote, sourcePath: ui.source && ui.source.sourcePath }), 200)
          quote.title = quoteWithSource({ text: ui.quote, sourcePath: ui.source && ui.source.sourcePath })
          card.appendChild(quote)
          var ta = document.createElement('textarea')
          ta.className = 'dsh-ann-input'
          ta.placeholder = t('edit.placeholder')
          ta.value = ui.noteDraft
          ta.spellcheck = false
          ta.addEventListener('input', function () { ui.noteDraft = ta.value })
          ta.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey && !isImeKeyBlocked(e)) { e.preventDefault(); saveAnnotation() }
          })
          card.appendChild(ta)
          var row = document.createElement('div')
          row.className = 'dsh-ann-row'
          var cancel = document.createElement('button')
          cancel.className = 'dsh-ann-cancel'
          cancel.type = 'button'
          cancel.textContent = t('common.cancel')
          cancel.addEventListener('click', closeToolbar)
          var save = document.createElement('button')
          save.type = 'button'
          save.className = 'dsh-ann-action'
          save.appendChild(ICONS.check())
          save.appendChild(document.createTextNode(t('edit.save')))
          save.addEventListener('click', saveAnnotation)
          row.appendChild(cancel)
          row.appendChild(save)
          card.appendChild(row)
          if (ui.error !== null) {
            var err = document.createElement('div')
            err.className = 'dsh-ann-error'
            err.textContent = ui.error
            card.appendChild(err)
          }
          host.appendChild(card)
          ta.focus()
          ta.setSelectionRange(ta.value.length, ta.value.length)
          requestAnimationFrame(function () {
            if (card.isConnected) positionEditor(card, ui.pos.left, ui.pos.top)
          })
        }
      }

      function positionEditor(card, left, top) {
        ui.pos = {
          left: Math.max(8, Math.min(left, window.innerWidth - card.offsetWidth - 8)),
          top: Math.max(8, Math.min(top, window.innerHeight - card.offsetHeight - 8)),
        }
        card.style.left = ui.pos.left + 'px'
        card.style.top = ui.pos.top + 'px'
      }

      function makeEditorDraggable(head, card) {
        var drag = null
        head.addEventListener('pointerdown', function (e) {
          if (e.button !== 0 || !e.isPrimary || e.target.closest('button')) return
          var r = card.getBoundingClientRect()
          drag = { id: e.pointerId, x: e.clientX - r.left, y: e.clientY - r.top }
          head.setPointerCapture(e.pointerId)
          e.preventDefault()
        })
        head.addEventListener('pointermove', function (e) {
          if (drag === null || e.pointerId !== drag.id) return
          positionEditor(card, e.clientX - drag.x, e.clientY - drag.y)
        })
        head.addEventListener('lostpointercapture', function () { drag = null })
      }

      // ---------- 批注标记 ----------
      var markersSig = null
      function markersSignature() {
        var parts = []
        for (var i = 0; i < ui.quotes.length; i++) {
          var q = ui.quotes[i]
          var range = locateQuote(q.text, q)
          if (range === null) { parts.push(q.id + ':gone'); continue }
          var rects = quoteRects(range, q)
          for (var c = 0; c < rects.length; c++) {
            var r = rects[c]
            if (r.width === 0 || r.height === 0) continue
            parts.push(q.id + ':' + Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.width) + ',' + Math.round(r.height))
          }
          if (rects.length > 0) parts.push(q.id + ':chip')
        }
        return parts.join('|')
      }

      function renderMarkers() {
        // 对整个标记层挖去输入框区域；滚动、尺寸变化时即使原文没动也要刷新。
        var composer = document.querySelector('[data-composer-card]')
        var r = composer !== null ? composer.getBoundingClientRect() : null
        overlay.style.clipPath = r !== null && r.width > 0 && r.height > 0
          ? 'polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, '
            + r.left + 'px ' + r.top + 'px, ' + r.right + 'px ' + r.top + 'px, '
            + r.right + 'px ' + r.bottom + 'px, ' + r.left + 'px ' + r.bottom + 'px, '
            + r.left + 'px ' + r.top + 'px)'
          : 'none'
        var sig = markersSignature()
        if (sig !== markersSig) {
          markersSig = sig
          overlay.textContent = ''
          buildMarkers()
        }
      }

      function buildMarkers() {
        if (ui.quotes.length === 0) return
        var placed = []
        for (var i = 0; i < ui.quotes.length; i++) {
          var q = ui.quotes[i]
          var range = locateQuote(q.text, q)
          if (range === null) continue
          var rects = quoteRects(range, q)
          for (var c = 0; c < rects.length; c++) {
            var rect = rects[c]
            if (rect.width === 0 || rect.height === 0) continue
            var hl = document.createElement('div')
            hl.className = 'dsh-ann-hl'
            hl.style.left = rect.left + 'px'
            hl.style.top = rect.top + 'px'
            hl.style.width = rect.width + 'px'
            hl.style.height = rect.height + 'px'
            overlay.appendChild(hl)
          }
          var anchor = null
          for (var k = 0; k < rects.length; k++) {
            var r = rects[k]
            if (r.width === 0 || r.height === 0) continue
            if (r.top > -8 && r.top < window.innerHeight) { anchor = r; break }
          }
          // 原文完全在视口外时不显示编号气泡（避免钉在屏幕顶部/底部）
          if (anchor !== null) {
            var chip = document.createElement('div')
            chip.className = 'dsh-ann-num'
            chip.textContent = String(i + 1)
            var chipTop = anchor.top - 20
            if (chipTop < 4) chipTop = Math.min(anchor.top + 2, window.innerHeight - 22)
            if (chipTop < 4) chipTop = 4
            var chipLeft = Math.max(4, Math.min(anchor.left - 4, window.innerWidth - 24))
            var tries = 0
            while (tries < 12) {
              var clash = false
              for (var p = 0; p < placed.length; p++) {
                var bp = placed[p]
                if (Math.abs(bp.left - chipLeft) < 18 && Math.abs(bp.top - chipTop) < 18) {
                  clash = true
                  break
                }
              }
              if (!clash) break
              chipLeft += 18
              if (chipLeft > window.innerWidth - 24) { chipLeft = 4; chipTop += 18 }
              tries++
            }
            placed.push({ left: chipLeft, top: chipTop })
            chip.style.left = chipLeft + 'px'
            chip.style.top = chipTop + 'px'
            ;(function (q) {
              chip.addEventListener('click', function (ev) {
                ev.stopPropagation()
                openEditorFor(q)
              })
            })(q)
            overlay.appendChild(chip)
          }
        }
      }

      // ---------- 动作 ----------
      function captureAnchor(text) {
        var anchor = {
          range: null, seqKey: '', rowHead: '', textOffset: -1,
          ctxBefore: '', ctxAfter: '',
        }
        try {
          var sel = window.getSelection()
          if (sel === null || sel.isCollapsed || sel.rangeCount === 0) return anchor
          var live = sel.getRangeAt(0)
          var liveText = live.toString()
          // 选区文本与 settle 快照一致才持有 live range；不一致（选区微变、DOM
          // 被批注芯片等装饰改写）时也绝不返回全空锚——尽力抓行级锚点
          // （seqKey/rowHead），让 locateQuote 在锚点消息内宽松重定位。
          var textMatch = liveText.trim() === text
            || liveText.trim().replace(/\s+/g, ' ') === text.replace(/\s+/g, ' ')
          if (textMatch) {
            anchor.range = live.cloneRange()
          }
          var source = documentSourceOf(live.commonAncestorContainer)
          if (source !== null) {
            anchor.sourceUrl = source.sourceUrl
            anchor.sourcePath = source.sourcePath
            anchor.textOffset = offsetOfRangeInRow(source.root, live) + liveText.indexOf(text)
            return anchor
          }
          var node = live.commonAncestorContainer
          var el = node instanceof Element ? node : (node !== null ? node.parentElement : null)
          // 主视图锚 key 为 data-chat-anchor-key；focus-chat 视图为
          // data-focus-anchor-key，两者等价（消息 seq 锚定）。
          while (el !== null && el !== document.body
            && !el.hasAttribute('data-chat-anchor-key')
            && !el.hasAttribute('data-focus-anchor-key')) {
            el = el.parentElement
          }
          if (el !== null
            && (el.hasAttribute('data-chat-anchor-key') || el.hasAttribute('data-focus-anchor-key'))) {
            anchor.seqKey = el.getAttribute('data-chat-anchor-key')
              || el.getAttribute('data-focus-anchor-key') || ''
            if (textMatch) {
              var itemText = el.textContent || ''
              var realOff = offsetOfRangeInRow(el, live)
              if (realOff >= 0) {
                anchor.textOffset = realOff
                anchor.ctxBefore = itemText.slice(Math.max(0, realOff - 24), realOff)
                anchor.ctxAfter = itemText.slice(realOff + text.length, realOff + text.length + 24)
              }
            }
          }
          var row = assistantRowOf(live.commonAncestorContainer)
          if (row !== null) {
            anchor.rowHead = (row.textContent || '').slice(0, 24)
          }
        } catch (_) { /* 抓取失败则保持空锚 */ }
        return anchor
      }

      function enterEditing() {
        ui.mode = 'editing'
        ui.noteDraft = ''
        ui.error = null
        ui.editingId = null
        ui.pendingAnchor = captureAnchor(ui.quote)
        render()
      }

      /** 点击角标数字 → 重新打开该批注的编辑面板（预填批注内容，可修改后保存）。 */
      function openEditorFor(q) {
        ui.mode = 'editing'
        ui.quote = q.text
        ui.source = q
        ui.noteDraft = q.note !== undefined ? q.note : ''
        ui.error = null
        ui.editingId = q.id
        ui.pendingAnchor = null
        var range = locateQuote(q.text, q)
        var rect = range !== null ? range.getBoundingClientRect() : null
        if (rect !== null && rect.width > 0) {
          var cardW = 400, cardH = 280
          var anchorX = rect.left + 10
          var cl = anchorX - cardW / 2
          cl = Math.max(8, Math.min(cl, window.innerWidth - cardW - 8))
          var ct = rect.bottom + 8
          if (ct + cardH > window.innerHeight - 8) ct = window.innerHeight - cardH - 8
          ui.pos = { left: Math.round(cl), top: Math.max(8, Math.round(ct)) }
        } else {
          ui.pos = { left: 8, top: 8 }
        }
        render()
      }

      /** 组装批注块；只有附带正文时才添加「提问：」分隔标记。 */
      function buildBlock(hasQuestion) {
        var n = ui.quotes.length
        var parts = ui.quotes.map(function (q, i) {
          var s = (i + 1) + '. ' + quoteWithSource(q).replace(/\n/g, '\n   ')
          if (q.note !== undefined && q.note.trim() !== '') {
            s += '\n   ' + t('block.notePrefix') + q.note.replace(/\n/g, '\n    ')
          }
          return s
        })
        return t(hasQuestion ? 'block.head' : 'block.headOnly', { n: n }) + '\n\n'
          + parts.join('\n\n')
          + '\n\n' + t(hasQuestion ? 'block.format' : 'block.formatOnly', { n: n })
          + (hasQuestion ? '\n\n' + t('block.marker') : '')
      }

      function shouldAttachForEnter(e, draft) {
        return !(e.ctrlKey || e.metaKey) || draft.trim() === ''
      }

      /** 裸斜杠开头的草稿按宿主约定是命令（/goal、/model 等）：
       *  宿主输入机靠「草稿以命令 token 开头」维持命令声明。 */
      function isCommandDraft(draft) {
        return draft.trimStart().charAt(0) === '/'
      }

      /** 提交前把批注块拼进 composer 草稿（随回车一起发送）。
       *  返回 true 表示批注块已在草稿中（本次刚拼入，或之前已拼入未发送）。
       *  服务不可用（inactive context / 作用域未物化）时回退 DOM 注入，绝不静默丢批注。 */
      function attachAndSend(e) {
        var current = currentSessionId()
        var scoped = scopeOfSession(current)
        var shell = shellFor(scoped)

        // ---- 服务路径（首选）----
        if (shell !== null) {
          try {
            var st = shell.state.getSnapshot()
            var draft = st.draft || ''
            if (!shouldAttachForEnter(e, draft)) return false
            if (isCommandDraft(draft)) {
              showToast(t('toast.skipCommand'))
              return false
            }
            if (hasAnnotationBlock(draft)) {
              annotationAttached = true
              return true
            }
            var hasQuestion = draft.trim() !== ''
            var block = buildBlock(hasQuestion)
            shell.setDraft(block + (hasQuestion ? '\n' + draft : ''))
            annotationAttached = true
            markFreshBubble()
            console.log('[annotation] 批注块已拼入草稿，回车将随消息发送（' + ui.quotes.length + ' 条）')
            return true
          } catch (err) {
            console.warn('[annotation] 服务路径拼稿失败，回退 DOM 注入：', err)
          }
        }

        // ---- DOM 回退路径（服务 inactive 时的兜底）----
        // 宿主编辑器就是 [data-composer-input] 可编辑区；把批注块插到草稿开头，
        // 随后宿主自己的 Enter / 发送按钮照常提交，批注随消息一起发出。
        try {
          var domDraft = domDraftText()
          if (!shouldAttachForEnter(e, domDraft)) return false
          if (isCommandDraft(domDraft)) {
            showToast(t('toast.skipCommand'))
            return false
          }
          if (hasAnnotationBlock(domDraft)) {
            annotationAttached = true
            return true
          }
          var hasQ = domDraft.trim() !== ''
          if (!domAttachBlock(buildBlock(hasQ), hasQ)) return false
          annotationAttached = true
          domAttached = true
          markFreshBubble()
          console.log('[annotation] 批注块已注入输入区（DOM 回退），回车将随消息发送（' + ui.quotes.length + ' 条）')
          return true
        } catch (err) {
          console.warn('[annotation] 批注拼稿失败：', err)
          showToast(t('toast.attachFail') + (err && err.message ? err.message : err))
          return false
        }
      }

      // 批注保存/删除完成后把焦点还给 composer 输入框（光标在末尾），
      // 用户可直接回车发送，无需再点一下输入框。
      // preventScroll：长会话中选中文字时输入框可能在视口外，默认 focus
      // 会强制滚动页面（视觉上"卡一下"）；延迟一帧让卡片关闭动画先完成，
      // 焦点回归更平滑。
      function focusComposer() {
        var input = document.querySelector('[data-composer-card] [data-composer-input]')
        if (!(input instanceof HTMLElement) || !input.isContentEditable) return
        requestAnimationFrame(function () {
          if (!input.isConnected) return
          input.focus({ preventScroll: true })
          var selection = window.getSelection()
          if (selection !== null) {
            selection.selectAllChildren(input)
            selection.collapseToEnd()
          }
        })
      }

      function saveAnnotation() {
        var text = ui.quote
        if (text === '') { ui.error = t('error.noSelection'); render(); return }
        var note = ui.noteDraft.trim()
        // 编辑已有批注（点击角标进入）：按 id 更新批注内容。
        if (ui.editingId !== null) {
          for (var ei = 0; ei < ui.quotes.length; ei++) {
            if (ui.quotes[ei].id === ui.editingId) {
              ui.quotes[ei].note = note
              ui.editingId = null
              ui.pendingAnchor = null
              ui.noteDraft = ''
              ui.error = null
              writeCurrentPendingQuotes()
              closeToolbar()
              updateChip()
              renderMarkers()
              focusComposer()
              return
            }
          }
          ui.editingId = null
        }
        if (!ui.quotes.some(function (q) { return q.text === text && (q.sourceUrl || '') === (ui.pendingAnchor && ui.pendingAnchor.sourceUrl || '') })) {
          var a = ui.pendingAnchor || { range: null, seqKey: '', rowHead: '', textOffset: -1, ctxBefore: '', ctxAfter: '' }
          ui.quotes.push({
            id: 'q-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
            text: text,
            note: note,
            range: a.range,
            ...(a.sourceUrl ? { sourceUrl: a.sourceUrl, sourcePath: a.sourcePath } : {}),
            seqKey: a.seqKey,
            rowHead: a.rowHead,
            textOffset: a.textOffset,
            ctxBefore: a.ctxBefore,
            ctxAfter: a.ctxAfter,
          })
        }
        writeCurrentPendingQuotes()
        ui.pendingAnchor = null
        ui.noteDraft = ''
        ui.error = null
        closeToolbar()
        updateChip()
        renderMarkers()
        focusComposer()
      }

      function removeQuote(id) {
        ui.quotes = ui.quotes.filter(function (q) { return q.id !== id })
        writeCurrentPendingQuotes()
        updateChip()
        render()
        renderMarkers()
        // 面板正在显示时同步重建：否则删掉的条目还留在面板里，必须重新 hover 才消失。
        if (tipLayer.childNodes.length > 0) showChipTip()
      }

      function closeToolbar() {
        if (ui.mode === 'closed') return
        clearSettle()
        ui.mode = 'closed'
        ui.error = null
        ui.busy = false
        ui.lastKey = ''
        ui.editingId = null
        ui.anchorRel = null
        ui.anchorPoint = null
        ui.anchorRect = null
        render()
      }

      // ---------- 输入框旁的批注标签（N 条批注 · 悬浮看全部内容） ----------
      var chipLayer = document.createElement('div')
      chipLayer.setAttribute('data-annotation-chip', '')
      chipLayer.style.cssText = 'position:fixed;z-index:1150;display:none;align-items:center;gap:4px;height:22px;padding:0 10px;border-radius:11px;border:1px solid var(--dsh-ann-border,rgba(0,0,0,.12));background:var(--dsh-ann-surface,#2c2c2e);box-shadow:var(--dsw-shadow-lv2);font-family:var(--dsw-font-family,system-ui);font-size:11px;color:var(--dsw-alias-label-primary);cursor:default;animation:dsh-ann-pop .12s var(--ds-ease-in-out, ease);'
      document.body.appendChild(chipLayer)
      var tipLayer = document.createElement('div')
      tipLayer.setAttribute('data-annotation-tip-layer', '')
      document.body.appendChild(tipLayer)
      var observedComposer = null
      var composerObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(onLayoutChange)
        : null

      function updateChip() {
        if (ui.quotes.length === 0) {
          chipLayer.style.display = 'none'
          tipLayer.textContent = ''
          return
        }
        chipLayer.textContent = ''
        var ic = document.createElement('span')
        ic.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;opacity:.7;flex:none;'
        ic.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"><path d="M2 3h8M2 6h8M2 9h5"/></svg>'
        chipLayer.appendChild(ic)
        chipLayer.appendChild(document.createTextNode(' ' + ui.quotes.length + ' 条批注'))
        var closeX = document.createElement('span')
        closeX.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;margin-left:2px;cursor:pointer;opacity:.6;flex:none;border-radius:7px;'
        closeX.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M2 2l6 6M8 2L2 8"/></svg>'
        closeX.addEventListener('click', function (ev) {
          ev.stopPropagation()
          ui.quotes = []
          annotationAttached = false
          writeCurrentPendingQuotes()
          tipLayer.textContent = ''
          updateChip()
          renderMarkers()
        })
        chipLayer.appendChild(closeX)
        var card = document.querySelector('[data-composer-card]')
        if (card !== observedComposer) {
          if (composerObserver !== null) composerObserver.disconnect()
          observedComposer = card
          if (composerObserver !== null && card !== null) composerObserver.observe(card)
        }
        if (card === null) { chipLayer.style.display = 'none'; return }
        var r = card.getBoundingClientRect()
        if (r.width === 0 || r.height === 0 || r.right <= 0 || r.bottom <= 0
          || r.left >= window.innerWidth || r.top >= window.innerHeight) {
          chipLayer.style.display = 'none'
          return
        }
        var w = chipLayer.offsetWidth || 80
        chipLayer.style.left = (r.left + 12) + 'px'
        chipLayer.style.top = Math.max(8, r.top - 30) + 'px'
        chipLayer.style.display = 'flex'
      }

      // 悬停宽限：标签与面板间有间隙，鼠标跨越间隙的瞬间不在任何元素上——
      // 离开后给 250ms 宽限期，期间进入面板则取消关闭（官方 HoverCard 的
      // pointer-grace 同款思路），同时杜绝闪烁循环。
      var hoverGrace = null
      function scheduleHide() {
        if (hoverGrace !== null) clearTimeout(hoverGrace)
        hoverGrace = setTimeout(function () {
          hoverGrace = null
          tipLayer.textContent = ''
        }, 250)
      }
      function cancelHide() {
        if (hoverGrace !== null) { clearTimeout(hoverGrace); hoverGrace = null }
      }
      chipLayer.addEventListener('mouseenter', function () { cancelHide(); showChipTip() })
      chipLayer.addEventListener('mouseleave', scheduleHide)
      tipLayer.addEventListener('mouseenter', cancelHide)
      tipLayer.addEventListener('mouseleave', scheduleHide)

      function showChipTip() {
        if (ui.quotes.length === 0) return
        tipLayer.textContent = ''
        var el = document.createElement('div')
        el.className = 'dsh-ann-tip'
        el.style.cssText = 'position:fixed;z-index:1160;width:280px;max-width:min(320px,calc(100vw - 24px));padding:8px 10px;border-radius:12px;border:1px solid var(--dsh-ann-border,rgba(0,0,0,.12));background:var(--dsh-ann-surface,#2c2c2e);box-shadow:var(--dsw-shadow-lv2);font-family:var(--dsw-font-family,system-ui);font-size:12px;color:var(--dsw-alias-label-primary);'
        for (var i = 0; i < ui.quotes.length; i++) {
          var q = ui.quotes[i]
          var item = document.createElement('div')
          item.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-top:' + (i === 0 ? 'none' : '1px solid var(--dsw-alias-border-strong,rgba(128,128,128,.15))') + ';cursor:pointer;border-radius:6px;margin:0 -4px;padding-left:4px;padding-right:4px;'
          var num = document.createElement('span')
          num.style.cssText = 'font-size:12px;color:var(--dsw-alias-label-tertiary);flex:none;min-width:20px;line-height:1.5;'
          num.textContent = (i + 1) + '。'
          item.appendChild(num)
          var mid = document.createElement('div')
          mid.style.cssText = 'flex:1;min-width:0;'
          var label = document.createElement('div')
          label.style.cssText = 'font-size:10px;color:var(--dsw-alias-label-tertiary);margin-bottom:2px;'
          label.textContent = '所选文本：'
          mid.appendChild(label)
          var quote = document.createElement('div')
          quote.style.cssText = 'font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary);word-break:break-word;margin-top:2px;'
          quote.textContent = quoteWithSource(q)
          mid.appendChild(quote)
          if (q.note !== undefined && q.note.trim() !== '') {
            var noteLabel = document.createElement('div')
            noteLabel.style.cssText = 'font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.4;margin-top:6px;'
            noteLabel.textContent = '用户评论：'
            mid.appendChild(noteLabel)
            var note = document.createElement('div')
            note.style.cssText = 'font-size:12px;line-height:1.5;color:var(--dsw-alias-label-primary);word-break:break-word;margin-top:2px;'
            note.textContent = q.note
            mid.appendChild(note)
          }
          item.appendChild(mid)
          ;(function (qq) {
            item.addEventListener('click', function () {
              try {
                var rng = locateQuote(qq.text, qq)
                if (rng !== null) {
                  var node = rng.startContainer
                  while (node !== null && node.nodeType !== 1) node = node.parentNode
                  if (node !== null) {
                    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
                    tipLayer.textContent = ''
                  }
                }
              } catch (_) {}
            })
          })(q)
          var actions = document.createElement('div')
          actions.style.cssText = 'display:flex;flex-direction:row;gap:4px;flex:none;margin-top:2px;'
          var editBtn = document.createElement('button')
          editBtn.type = 'button'
          editBtn.title = '编辑批注'
          editBtn.style.cssText = 'width:26px;height:26px;border:none;background:transparent;cursor:pointer;border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);'
          editBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2.5l2 2L5 11l-2.5.5L3.5 9z"/></svg>'
          ;(function (qq) {
            editBtn.addEventListener('click', function (ev) {
              ev.stopPropagation()
              tipLayer.textContent = ''
              // 先平滑滚动到原文位置，等滚完再弹窗编辑
              try {
                var rng = locateQuote(qq.text, qq)
                if (rng !== null) {
                  var node = rng.startContainer
                  while (node !== null && node.nodeType !== 1) node = node.parentNode
                  if (node !== null) {
                    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
                    // center 后再往上推一点，给下方弹窗腾空间
                    setTimeout(function () {
                      try { window.scrollBy({ top: -260, behavior: 'smooth' }) } catch (_) {}
                    }, 50)
                  }
                }
              } catch (_) {}
              // 等滚动动画完成后再打开编辑器（此时 rect 位置才准确）
              setTimeout(function () { openEditorFor(qq) }, 500)
            })
          })(q)
          actions.appendChild(editBtn)
          var del = document.createElement('button')
          del.type = 'button'
          del.title = '删除此批注'
          del.style.cssText = 'width:26px;height:26px;border:none;background:transparent;cursor:pointer;border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);'
          del.innerHTML = '<svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.5h9M5 3.5V2h4v1.5M3.5 3.5l.7 8.5h5.6l.7-8.5M5.8 6v3.5M8.2 6v3.5"/></svg>'
          ;(function (qid) {
            del.addEventListener('click', function (ev) {
              ev.stopPropagation()
              removeQuote(qid)
              tipLayer.textContent = ''
              showChipTip()
            })
          })(q.id)
          actions.appendChild(del)
          item.appendChild(actions)
          el.appendChild(item)
        }
        tipLayer.appendChild(el)
        // 定位：右对齐到 chipLayer 右边缘，再 clamp 到视口内
        var r2 = chipLayer.getBoundingClientRect()
        var w2 = Math.min(el.offsetWidth || 280, window.innerWidth - 16)
        var h2 = el.offsetHeight || 120
        var left = r2.left
        if (left < 8) left = 8
        if (left + w2 > window.innerWidth - 8) left = window.innerWidth - w2 - 8
        var top = r2.top - h2 - 6
        if (top < 8) top = r2.bottom + 6
        el.style.left = left + 'px'
        el.style.top = Math.max(8, top) + 'px'
        el.style.width = w2 + 'px'
      }

            // ---------- 发送完成监听（草稿从有内容变空 → 清空批注集） ----------
      var inputUnsub = null
      // 仅当批注块真正拼入过草稿（用户按过回车）才在草稿清空时清除批注，
      // 避免普通草稿编辑（打字后删字）误触发「已发送」判定而清空批注集。
      var annotationAttached = false
      // DOM 回退注入路径标记（服务 inactive 时走）：其清空由 DOM 观察器负责。
      var domAttached = false
      var inputWatchTimer = null
      var domWatchObserver = null

      /** 发送完成：脚标消失、编号下次从 1 开始，并给刚发出的气泡贴「N 条批注」标签。 */
      function clearSentQuotes() {
        if (ui.quotes.length === 0) return
        var sentItems = ui.quotes.map(function (q) {
          return { text: quoteWithSource(q), note: q.note || '' }
        })
        ui.quotes = []
        annotationAttached = false
        domAttached = false
        writeCurrentPendingQuotes()
        tipLayer.textContent = ''
        updateChip()
        renderMarkers()
        pendingDeco.push({ items: sentItems })
        // 草稿已提交：新气泡马上出现，打开「任何批次都同步隐藏」的窗口。
        markFreshBubble()
        kickDecorate()
      }

      /** 服务订阅路径：草稿「有 → 空」迁移即发送完成。 */
      function tryWatchInputDraft(id) {
        try {
          var sh = shellFor(scopeOfSession(id))
          if (sh === null || typeof sh.state.subscribe !== 'function') return false
          var hadDraft = false
          inputUnsub = sh.state.subscribe(function () {
            var d = (sh.state.getSnapshot().draft || '').trim()
            var wasHad = hadDraft
            hadDraft = d !== ''
            if (ui.quotes.length === 0) return
            if (wasHad && d === '' && annotationAttached) clearSentQuotes()
          })
          return true
        } catch (_) { inputUnsub = null; return false }
      }

      /** DOM 回退订阅：直接观察 [data-composer-input] 的文本，覆盖服务 inactive 场景。
       *  DOM 观察器常驻（服务恢复后二者幂等：clearSentQuotes 首行即空集短路）。 */
      function ensureDomWatch() {
        if (domWatchObserver !== null) return
        if (typeof MutationObserver !== 'function') return
        var hadDom = false
        domWatchObserver = new MutationObserver(function () {
          if (ui.quotes.length === 0) { hadDom = false; return }
          var d = domDraftText().trim()
          var wasHad = hadDom
          hadDom = d !== ''
          // 只认「有 → 空」迁移，且批注块真的拼入过草稿（annotationAttached）。
          // 不区分服务路径与 DOM 回退路径：两条路径下输入区文本都会「有→空」，
          // 而会话切换/刷新只重渲染历史消息、不碰输入区草稿，不会误判（issue #28）。
          if (wasHad && d === '' && annotationAttached) clearSentQuotes()
        })
        domWatchObserver.observe(document.body, { childList: true, subtree: true, characterData: true })
      }
      // 发送清空认两路「草稿有→空」迁移：服务订阅（首选）+ DOM 观察（回退）。
      // 插件可能先于会话加载完成：current 未定、scope/input 尚不可用时订阅会失败，
      // 必须每秒重试直到挂上，否则一次发送的清空被漏掉，已发送的批注会永远留在
      // 待发送集里，之后每次 Enter 都重新拼进草稿。
      function watchInputDraft() {
        if (inputWatchTimer !== null) { clearInterval(inputWatchTimer); inputWatchTimer = null }
        if (typeof inputUnsub === 'function') { inputUnsub(); inputUnsub = null }
        ensureDomWatch()
        var id = currentSessionId()
        if (id !== undefined && tryWatchInputDraft(id)) return
        inputWatchTimer = setInterval(function () {
          var cur = currentSessionId()
          if (cur !== undefined && tryWatchInputDraft(cur)) {
            clearInterval(inputWatchTimer)
            inputWatchTimer = null
          }
        }, 1000)
      }

      /** 把批注块文本从用户消息气泡里藏掉（模型消息内容不受影响）：
       *  用户气泡是纯文本渲染（MessageText，单个文本节点），
       *  找到最后一个「\n提问：」（老格式回退「\n问题：」），
       *  保留其后的用户问题，整块批注文本从 DOM 移除。
       *  返回是否成功（内容未渲染完时返回 false，轮询稍后重试）。 */
      /** 把「拼接后的文本坐标区间 [start, end)」从对应的文本节点里抹掉（跨节点），
       *  保留区间两端的内容——容器里往往还夹着别的东西（时间戳、操作按钮、回显状态字）。 */
      function cutRange(nodes, start, end) {
        var pos = 0
        for (var i = 0; i < nodes.length; i++) {
          var val = nodes[i].nodeValue || ''
          var nodeStart = pos
          var nodeEnd = pos + val.length
          pos = nodeEnd
          if (nodeEnd <= start || nodeStart >= end) continue
          var keepHead = nodeStart < start ? val.slice(0, start - nodeStart) : ''
          var keepTail = nodeEnd > end ? val.slice(end - nodeStart) : ''
          nodes[i].nodeValue = keepHead + keepTail
        }
      }

      /** 清掉容器里被手术掏空的元素（div/span/p）。 */
      function pruneEmpty(container) {
        var empties = container.querySelectorAll('div,span,p')
        for (var e = 0; e < empties.length; e++) {
          var em = empties[e]
          if (em.parentNode !== null && (em.textContent || '').trim() === '') em.remove()
        }
      }

      function hideAnnotationBlock(row, container) {
        try {
          // container 显式给出时直接用它；否则用行内的气泡元素。**必须落在气泡上而不是整行**：
          // 行里还含时间戳等文本，会让「纯批注」的判定失败（v1.4.24 就栽在这里）。
          var bubble = container !== undefined ? container : row.querySelector('[class*="bubble"]')
          if (bubble === null) return false
          var nodes = []
          var full = ''
          var walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT)
          var n
          while ((n = walker.nextNode()) !== null) {
            nodes.push(n)
            full += n.nodeValue || ''
          }
          // 纯批注：定位 headOnly…formatOnly 这一整段并切掉，**不要求整段文本恰好等于块本身**
          // （容器里可能夹着别的东西）。首尾文案同时命中即可——这样原文里出现「提问：」也不会
          // 被误当成正文分隔符。
          var langs = ['zh', 'en']
          var headIdx = -1
          var tailEnd = -1
          for (var li = 0; li < langs.length; li++) {
            var hStr = dictVal(langs[li], 'block.headOnly')
            var fStr = dictVal(langs[li], 'block.formatOnly')
            var hi = full.indexOf(hStr)
            if (hi === -1) continue
            var fi = full.indexOf(fStr, hi + hStr.length)
            if (fi === -1) continue
            if (headIdx === -1 || hi < headIdx) { headIdx = hi; tailEnd = fi + fStr.length }
          }
          if (headIdx !== -1) {
            cutRange(nodes, headIdx, tailEnd)
            pruneEmpty(bubble)
            return true
          }
          // 标记定位：当前语言优先（zh「提问：」/ en「Ask:」，均先带「\n」再裸匹配），
          // 另兼容另一语言与「问题：」老格式，保证历史消息跨语言切换可解析。
          var markers = blockMarkers()
          var marker = -1
          var markerStr = ''
          for (var p = 0; p < markers.length && marker === -1; p++) {
            var idx = full.lastIndexOf(markers[p])
            if (idx !== -1) { marker = idx; markerStr = markers[p] }
          }
          if (marker === -1) return false
          // 连同分隔标记一起切掉，保留其后的问题。
          var skip = markerStr.length
          // 定位到具体文本节点。
          var pos = 0
          var ti = -1
          var inner = 0
          for (var j = 0; j < nodes.length; j++) {
            var len = (nodes[j].nodeValue || '').length
            if (marker < pos + len) { ti = j; inner = marker - pos; break }
            pos += len
          }
          if (ti === -1) return false
          // 去掉标记及其前的所有内容，保留其后的问题。
          nodes[ti].nodeValue = (nodes[ti].nodeValue || '').slice(inner + skip).replace(/^\s+/, '')
          for (var m2 = ti - 1; m2 >= 0; m2--) {
            if (nodes[m2].parentNode !== null) nodes[m2].parentNode.removeChild(nodes[m2])
          }
          // 清理空元素。
          pruneEmpty(bubble)
          return true
        } catch (err) {
          console.warn('[annotation] 气泡隐藏手术失败：', err)
          return false
        }
      }

      /** 提交回显气泡（`[data-submission-echo]`）也显示刚提交的草稿原文——它**不是消息行**，
       *  decorateAll 只扫 allMessageRows()，永远看不到它。宿主源码写明它
       *  「visible from the submit click until the durable user/message renders」
       *  （dsh-client-ui-chat: PendingSubmissionBubble），而 ChatNodeList 把 pendingRows
       *  直接追加在列表末尾、没有 ChatNodeSeat 包装，所以它拿不到 data-chat-flow-kind。
       *  处理方式与普通气泡一致（反解析条目 → 隐藏块 → 贴「批注 ×N」），这样用户从点击那一刻
       *  看到的就是标签而不是原文。 */
      function hideDockEchoBlocks() {
        var echoes = document.querySelectorAll('[data-submission-echo]')
        for (var i = 0; i < echoes.length; i++) {
          var row = echoes[i]
          if (row.querySelector('[data-annotation-bubble-tag]') !== null) continue
          if (!hasAnnotationBlock(row.textContent || '')) continue
          // 先反解析（必须在隐藏之前），再动 DOM。注意传 row 而不是 row 本身当容器：
          // hideAnnotationBlock 会自己落到 [class*="bubble"] 上。
          var items = parseItemsFromBubble(row)
          if (!hideAnnotationBlock(row)) continue
          if (items.length > 0) attachBubbleTag(row, items)
        }
      }

      /** 从气泡文本反解析批注条目（用于刷新后旧消息的 hover 内容）。 */
      function parseItemsFromBubble(row) {
        try {
          var b = row.querySelector('[class*="bubble"]')
          var text = (b ? b.textContent : '') || ''
          var mi = -1
          for (var mk = 0; mk < PARSE_MARKERS.length; mk++) {
            var pmi = text.lastIndexOf(PARSE_MARKERS[mk])
            if (pmi > mi) mi = pmi
          }
          if (mi !== -1) text = text.slice(0, mi)
          var nl = text.indexOf('\n\n')
          var body = nl === -1 ? '' : text.slice(nl + 2)
          var out = []
          var parts = body.split('\n\n')
          for (var i = 0; i < parts.length; i++) {
            var mm = /^(\d+)\.\s*([\s\S]*)$/.exec(parts[i])
            if (mm === null) continue
            var item = mm[2]
            var note = ''
            var nm = /\n\s*(?:批注：|Note:)\s*([\s\S]*)$/.exec(item)
            if (nm !== null) { note = nm[1].trim(); item = item.slice(0, nm.index) }
            out.push({ text: item.replace(/\n   /g, '\n').trim(), note: note })
          }
          return out
        } catch (_) { return [] }
      }

      /** 在用户气泡上贴「批注 ×N」标签（hover 显示条目内容）。 */
      function attachBubbleTag(row, items) {
        if (row.querySelector('[data-annotation-bubble-tag]') !== null) return
        var bubble = row.querySelector('[class*="bubble"]') || row
        var tag = document.createElement('span')
        tag.setAttribute('data-annotation-bubble-tag', '')
        tag.textContent = t('bubble.tag', { n: items.length })
        tag.style.cssText = 'display:inline-flex;align-items:center;height:18px;padding:0 8px;margin:4px 0 0 4px;border-radius:9px;border:1px solid var(--dsh-ann-border,rgba(0,0,0,.12));background:var(--dsh-ann-surface,#2c2c2e);color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family,system-ui);font-size:10px;cursor:default;'
        ;(function (list) {
          tag.addEventListener('mouseenter', function () {
            tipLayer.textContent = ''
            var el = document.createElement('div')
            el.className = 'dsh-ann-tip'
            el.style.cssText = 'position:fixed;z-index:1160;width:300px;max-width:calc(100vw - 16px);padding:10px 12px;border-radius:12px;border:1px solid var(--dsh-ann-border,rgba(0,0,0,.12));background:var(--dsh-ann-surface,#2c2c2e);box-shadow:var(--dsw-shadow-lv2);font-family:var(--dsw-font-family,system-ui);font-size:12px;color:var(--dsw-alias-label-primary);'
            var head = document.createElement('div')
            head.style.cssText = 'font-weight:600;margin-bottom:6px;'
            head.textContent = t('bubble.title', { n: list.length })
            el.appendChild(head)
            for (var i = 0; i < list.length; i++) {
              var item = document.createElement('div')
              item.style.cssText = 'padding:6px 0;border-top:1px solid var(--dsw-alias-border-strong,#444);'
              var num = document.createElement('span')
              num.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;margin-right:6px;border-radius:8px;background:var(--dsw-alias-text-accent,#4c9aff);color:#fff;font-size:10px;font-weight:700;'
              num.textContent = String(i + 1)
              var body = document.createElement('span')
              body.style.cssText = 'font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary);'
              body.textContent = truncate(list[i].text, 50)
              item.appendChild(num)
              item.appendChild(body)
              if (list[i].note !== '') {
                var note = document.createElement('div')
                note.style.cssText = 'font-size:11px;color:var(--dsw-alias-label-secondary);margin:2px 0 0 22px;word-break:break-word;'
                note.textContent = t('tip.notePrefix') + truncate(list[i].note, 60)
                item.appendChild(note)
              }
              el.appendChild(item)
            }
            tipLayer.appendChild(el)
            var r2 = tag.getBoundingClientRect()
            var w2 = 300
            var h2 = el.offsetHeight || 120
            var left = Math.max(8, Math.min(r2.left, window.innerWidth - w2 - 8))
            var top = r2.bottom + 6
            if (top + h2 > window.innerHeight - 8) top = r2.top - h2 - 6
            el.style.left = left + 'px'
            el.style.top = Math.max(8, top) + 'px'
            el.style.width = w2 + 'px'
          })
          var bubbleGrace = null
          function bubbleHide() {
            if (bubbleGrace !== null) clearTimeout(bubbleGrace)
            bubbleGrace = setTimeout(function () {
              bubbleGrace = null
              tipLayer.textContent = ''
            }, 250)
          }
          function bubbleKeep() {
            if (bubbleGrace !== null) { clearTimeout(bubbleGrace); bubbleGrace = null }
          }
          tag.addEventListener('mouseleave', bubbleHide)
          tipLayer.addEventListener('mouseenter', bubbleKeep)
          tipLayer.addEventListener('mouseleave', bubbleHide)
        })(items)
        tag.__annotationItems = items
        bubble.appendChild(tag)
        console.log('[annotation] 气泡已贴批注标签 ×' + items.length)
      }

      /** 发送完成时暂存批注数据（供气泡 hover 面板使用）。 */
      var pendingDeco = []

      // ---------- 助手回复中的「Annotation N：」→ 悬浮批注芯片 ----------

      /** 找到该回复行之前最近一条携带批注标签的用户消息的条目数据。 */
      function findPrevAnnotationItems(row) {
        var rows = allMessageRows()
        var idx = rows.indexOf(row)
        if (idx === -1) return null
        for (var i = idx - 1; i >= 0; i--) {
          var tag = rows[i].querySelector('[data-annotation-bubble-tag]')
          if (tag !== null && Array.isArray(tag.__annotationItems) && tag.__annotationItems.length > 0) {
            return tag.__annotationItems
          }
        }
        return null
      }

      /** 一次性诊断（仅控制台，不打扰用户）：标记行 + 原因。 */
      function markRowDiag(row, msg) {
        if (row.hasAttribute('data-annotation-diag')) return
        row.setAttribute('data-annotation-diag', '')
        console.warn('[annotation] ' + msg, row)
      }

      /** 扫描所有已结束流式输出的助手行：把「Annotation N：」替换为可悬浮芯片。 */
      /** 流式 mutation 批次的芯片装饰限流: 前导 + 500ms 拖尾, 每批次最多触发一次
       *  增量扫描(只扫助手行), 代替逐批全文档 decorateAll。 */
      var lastAssistantDecorate = 0
      var assistantDecorateTimer = null
      function scheduleAssistantDecorate() {
        var now = performance.now()
        if (now - lastAssistantDecorate >= 500) {
          lastAssistantDecorate = now
          decorateAssistantAnnotations()
          return
        }
        if (assistantDecorateTimer !== null) return
        assistantDecorateTimer = setTimeout(function () {
          assistantDecorateTimer = null
          lastAssistantDecorate = performance.now()
          decorateAssistantAnnotations()
        }, 500 - (now - lastAssistantDecorate))
      }

      function decorateAssistantAnnotations() {
        var rows = assistantRows()
        for (var i = 0; i < rows.length; i++) {
          var el = rows[i]
          if (!isAssistantRow(el) && !isFocusAssistantRow(el)) continue
          // 新版 data-streaming 标记在 AssistantMarkdown 内部元素上（行元素
          // 本身没有）——必须查行内，否则流式输出途中就把「Annotation N：」
          // 替换成芯片，与 React 正在更新的文本节点冲突，整条回复可能渲染
          // 异常（表现为看不到回复消息）。
          if (el.hasAttribute('data-streaming') || el.querySelector('[data-streaming]') !== null) continue
          if (el.querySelector('[data-annotation-reply-chip]') !== null) continue
          if ((el.textContent || '').indexOf('Annotation') === -1) continue
          var items = findPrevAnnotationItems(el)
          if (items === null || items.length === 0) {
            // 拿不到条目数据也照样生成芯片（hover 显示占位），并一次性提示。
            items = []
            markRowDiag(el, '未找到批注条目数据，芯片将显示占位内容（可继续用）')
          }
          decorateAnnotationLabels(el, items)
        }
      }

      /** 在行内所有文本节点中找「Annotation N：」（不区分大小写），替换为芯片。 */
      function decorateAnnotationLabels(row, items) {
        var re = /Annotation[\s\u200b\u200c\u200d\u00ad]*(\d+)[\s\u200b\u200c\u200d\u00ad]*[:：]/gi
        // 先快照所有文本节点，再逐个处理：遍历中途修改树会让 TreeWalker
        // 指针失效（处理完第一个节点后遍历就断了）——这是「只有第一个
        // Annotation 变成芯片」的根因。
        var nodes = []
        var walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
        var n
        while ((n = walker.nextNode()) !== null) nodes.push(n)
        var done = 0
        for (var i = 0; i < nodes.length; i++) {
          n = nodes[i]
          if (n.parentNode === null) continue
          var v = n.nodeValue || ''
          re.lastIndex = 0
          if (!re.test(v)) continue
          var frag = document.createDocumentFragment()
          var last = 0
          re.lastIndex = 0
          var m
          while ((m = re.exec(v)) !== null) {
            if (m.index > last) frag.appendChild(document.createTextNode(v.slice(last, m.index)))
            frag.appendChild(makeReplyChip(parseInt(m[1], 10), items))
            last = m.index + m[0].length
            done++
          }
          if (last < v.length) frag.appendChild(document.createTextNode(v.slice(last)))
          n.parentNode.replaceChild(frag, n)
        }
        if (done > 0) {
          console.log('[annotation] 回复批注芯片 ×' + done, row.querySelectorAll('[data-annotation-reply-chip]').length + ' 个元素')
        } else {
          // 行内含 Annotation 但一个都没匹配上 → 文本节点里没有完整「Annotation N：」模式
          markRowDiag(row, '行内含 Annotation 但未匹配到「Annotation N：」模式')
        }
      }

      /** 构造「Annotation N」芯片（hover 显示该批注的原文与批注内容）。 */
      function makeReplyChip(num, items) {
        var chip = document.createElement('span')
        chip.setAttribute('data-annotation-reply-chip', '')
        chip.style.cssText = 'display:inline-flex;align-items:center;height:18px;padding:0 6px;margin:0 2px;border-radius:9px;border:1px solid var(--dsh-ann-border,rgba(0,0,0,.12));background:var(--dsh-ann-surface,#2c2c2e);color:var(--dsw-alias-text-accent,#4c9aff);font-family:var(--dsw-font-family,system-ui);font-size:11px;font-weight:600;cursor:default;vertical-align:middle;'
        chip.textContent = 'Annotation ' + num
        var item = items[num - 1]
        var grace = null
        function hide() {
          if (grace !== null) clearTimeout(grace)
          grace = setTimeout(function () { grace = null; tipLayer.textContent = '' }, 250)
        }
        function keep() {
          if (grace !== null) { clearTimeout(grace); grace = null }
        }
        chip.addEventListener('mouseenter', function () {
          tipLayer.textContent = ''
          var el = document.createElement('div')
          el.className = 'dsh-ann-tip'
          el.style.cssText = 'position:fixed;z-index:1160;width:320px;max-width:calc(100vw - 16px);padding:10px 12px;border-radius:12px;border:1px solid var(--dsh-ann-border,rgba(0,0,0,.12));background:var(--dsh-ann-surface,#2c2c2e);box-shadow:var(--dsw-shadow-lv2);font-family:var(--dsw-font-family,system-ui);font-size:12px;color:var(--dsw-alias-label-primary);'
          var head = document.createElement('div')
          head.style.cssText = 'font-weight:600;margin-bottom:6px;'
          head.textContent = item !== undefined ? t('reply.headWithQuote', { n: num }) : t('reply.headNoQuote', { n: num })
          el.appendChild(head)
          if (item !== undefined) {
            var quote = document.createElement('div')
            quote.style.cssText = 'font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);word-break:break-word;padding:6px 8px;border-radius:8px;background:rgba(127,127,127,.12);'
            quote.textContent = truncate(item.text, 140)
            el.appendChild(quote)
            if (item.note !== '') {
              var note = document.createElement('div')
              note.style.cssText = 'font-size:11px;color:var(--dsw-alias-text-accent,#4c9aff);margin-top:6px;word-break:break-word;'
              note.textContent = t('reply.notePrefix') + truncate(item.note, 80)
              el.appendChild(note)
            }
          } else {
            var none = document.createElement('div')
            none.style.cssText = 'font-size:11px;color:var(--dsw-alias-label-tertiary);'
            none.textContent = t('reply.missing')
            el.appendChild(none)
          }
          tipLayer.appendChild(el)
          var r2 = chip.getBoundingClientRect()
          var w2 = 320
          var h2 = el.offsetHeight || 100
          var left = Math.max(8, Math.min(r2.left, window.innerWidth - w2 - 8))
          var top = r2.bottom + 6
          if (top + h2 > window.innerHeight - 8) top = r2.top - h2 - 6
          el.style.left = left + 'px'
          el.style.top = Math.max(8, top) + 'px'
          el.style.width = w2 + 'px'
        })
        chip.addEventListener('mouseleave', hide)
        tipLayer.addEventListener('mouseenter', keep)
        tipLayer.addEventListener('mouseleave', hide)
        return chip
      }

      /** 全局轮询装饰：找所有「携带批注块但未装饰」的用户气泡 → 隐藏批注块 + 贴标签。
       *  不依赖发送事件链：异步渲染、刷新后的历史消息都能被覆盖。 */
      function decorateAll() {
        try {
          // 每秒轮询 + 每个 mutation 批次都会走到这里：即使残留层是在本实例
          // 启动之后才被别的实例塞进来的，也会在一个周期内收敛回单份。
          sweepStrayLayers()
          hideDockEchoBlocks()
          var rows = allMessageRows()
          for (var i = rows.length - 1; i >= 0; i--) {
            var el = rows[i]
            if (el.hasAttribute('data-pending-steering')) continue
            if (el.querySelector('[data-annotation-bubble-tag]') !== null) continue
            var b = el.querySelector('[class*="bubble"]')
            if (b === null || !hasAnnotationBlock(b.textContent || '')) continue
            // 最新一条优先消费发送时暂存的数据；其余从气泡文本反解析（须在隐藏前）。
            var items = null
            var fromSend = false
            if (i === rows.length - 1 && pendingDeco.length > 0) { items = pendingDeco[0].items; fromSend = true }
            if (items === null || items.length === 0) { items = parseItemsFromBubble(el); fromSend = false }
            if (!hideAnnotationBlock(el)) continue // 内容未渲染完 → 留给下轮（发送暂存数据不弹出）
            if (fromSend) pendingDeco.shift()
            attachBubbleTag(el, items)
            // 这里绝不清空待发送批注：DOM 层面无法区分「刚发送的消息」与「会话
            // 切换/刷新后重新渲染的历史消息」，历史消息重装饰曾被误判为已发送而
            // 清空刚恢复的待发送批注（issue #28 复测）。发送清空的唯一权威是
            // watchInputDraft 的「草稿有→空」迁移，其初始化时序洞由订阅重试补齐。
          }
          // 助手回复：把「Annotation N：」变为可悬浮的批注芯片（内容取自最近一条带批注的用户消息）。
          decorateAssistantAnnotations()
        } catch (err) {
          console.warn('[annotation] 装饰扫描失败：', err)
        }
      }

      var decoTimer = null
      function kickDecorate() {
        decorateAll()
        if (decoTimer === null) decoTimer = setInterval(function () {
          decorateAll()
          syncSendButton()
        }, 1000)
      }

      // ---------- locale 服务（zh/en）订阅与实时回流 ----------
      // locale.subscribe() 触发时：重绘打开中的浮层、更新输入框旁计数与历史气泡标签。
      // 服务缺失（旧 host / 测试环境）时保持 zh，全部功能不变。
      var localeUnsub = null
      function applyLocale() {
        var next = 'zh'
        try {
          if (ctx.locale !== undefined && ctx.locale !== null
            && typeof ctx.locale.getSnapshot === 'function') {
            var snap = ctx.locale.getSnapshot()
            if (snap !== undefined && snap !== null && snap.active) next = String(snap.active)
          }
        } catch (_) { /* keep zh */ }
        if (next === currentLang) return
        setLang(next)
        if (ui.mode !== 'closed') render()
        updateChip()
        // 打开的悬浮面板按新语言关闭（下次 hover 以新语言重建）。
        tipLayer.textContent = ''
        var tags = document.querySelectorAll('[data-annotation-bubble-tag]')
        for (var i = 0; i < tags.length; i++) {
          var items = tags[i].__annotationItems
          if (Array.isArray(items)) tags[i].textContent = t('bubble.tag', { n: items.length })
        }
      }
      applyLocale()
      if (ctx.locale !== undefined && ctx.locale !== null
        && typeof ctx.locale.subscribe === 'function') {
        try { localeUnsub = ctx.locale.subscribe(applyLocale) } catch (_) { localeUnsub = null }
      }

      // ---------- 待发送批注按会话恢复 ----------
      var lastSessionId = currentSessionId()
      ui.quotes = readPendingQuotes(lastSessionId)
      var unsub = null
      setInterval(function () {
        var cur = currentSessionId()
        if (cur === lastSessionId) return
        writePendingQuotes(lastSessionId)
        lastSessionId = cur
        if (ui.mode !== 'closed') closeToolbar()
        ui.quotes = readPendingQuotes(cur)
        annotationAttached = false
        // 旧会话未消费的发送暂存作废：留着会被新会话的历史消息误消费（错贴标签）；
        // 旧会话那条消息回切后会由气泡反解析路径重新装饰。
        pendingDeco.length = 0
        ui.noteDraft = ''
        tipLayer.textContent = ''
        updateChip()
        watchInputDraft()
        renderMarkers()
      })

      watchInputDraft()
      kickDecorate()
      updateChip()

      // ---------- 清理 ----------
      function teardown() {
        clearSettle()
        document.removeEventListener('selectionchange', onSelection)
        document.removeEventListener('pointerdown', onDocPointerDown, true)
        document.removeEventListener('keydown', onKeyDown, true)
        document.removeEventListener('click', onSendButtonActivate, true)
        releaseSendButton()
        if (sendBtnObserver !== null) { sendBtnObserver.disconnect(); sendBtnObserver = null }
        document.removeEventListener('compositionstart', markImeComposing, true)
        document.removeEventListener('compositionend', markImeEnded, true)
        if (imeClearTimer !== null) { clearTimeout(imeClearTimer); imeClearTimer = null }
        window.removeEventListener('scroll', onLayoutChange, true)
        window.removeEventListener('resize', onLayoutChange)
        host.removeEventListener('pointerdown', onHostPointerDown)
        document.removeEventListener('pointerdown', onPointerDownTrack, true)
        document.removeEventListener('pointermove', onPointerMoveTrack, true)
        document.removeEventListener('pointerup', onPointerUpTrack, true)
        document.removeEventListener('pointercancel', onPointerUpTrack, true)
        observer.disconnect()
        if (domWatchObserver !== null) { domWatchObserver.disconnect(); domWatchObserver = null }
        if (typeof unsub === 'function') unsub()
        if (inputWatchTimer !== null) { clearInterval(inputWatchTimer); inputWatchTimer = null }
        if (typeof inputUnsub === 'function') inputUnsub()
        if (typeof localeUnsub === 'function') localeUnsub()
        if (decoTimer !== null) { clearInterval(decoTimer); decoTimer = null }
        if (composerObserver !== null) composerObserver.disconnect()
        chipLayer.remove()
        tipLayer.remove()
        host.remove()
        overlay.remove()
        // 仅当自己仍是「当前实例」时才清场：旧实例被延迟 dispose 时（fiber 卸载
        // 晚于新实例 apply），以旧 host/overlay 为基准的 sweep 会把新实例的浮层
        // 误判成残留删掉。不是当前实例就静默退出。
        if (window.__dshAnnotationTeardown === teardown) sweepStrayLayers()
        // 解除全局 teardown 引用，避免下一实例撤掉自己。
        if (window.__dshAnnotationTeardown === teardown) window.__dshAnnotationTeardown = null
      }
      // fiber 重载 / 热重载时由下一实例调用，撤销本实例的全局副作用。
      window.__dshAnnotationTeardown = teardown
      try {
        var reg2 = window[INSTANCE_REGISTRY]
        if (Array.isArray(reg2)) reg2.push(teardown)
      } catch (_) {}
      return teardown
    }

    exports.name = '@changfenhuang/dsh-annotation'
    exports.inject = ['sessions', 'conversation', 'locale']
    exports.apply = apply

    return module.exports
  },
})
