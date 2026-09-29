// v1.4.21/v1.4.22 · 空草稿纯批注的发送按钮（结构 + 决策守卫）
//
// 背景：宿主 InputBar 的发送按钮在草稿为空时是 disabled 的
//   empty = draft.trim() === '' && attachments.length === 0
//   primaryDisabled = primaryStops ? stop === undefined : empty || disabled || machineBusy || uploadsPending
// 而浏览器不会给 disabled 的表单控件派发 pointer/mouse 事件，所以「监听按钮上的
// pointerdown」永远等不到事件（v1.4.20 及之前的写法，注释里的假设是错的）。
// 本测试锁住接管策略：主动摘 disabled + capture 阶段接管 click，以及三道守卫
// （有附件不接管 / 提交途中不接管 / 还原时要求仍是普通发送按钮）。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/** 取出一个函数的源码并注入自由变量，返回可调用的函数（同 enter-policy 的写法）。 */
function extract(name, deps = {}) {
  const match = source.match(new RegExp(`function ${name}\\(([^)]*)\\) \\{[\\s\\S]*?\\n      \\}`))
  assert.ok(match, `client.js should define ${name}`)
  const keys = Object.keys(deps)
  return Function(...keys, `return (${match[0]})`)(...keys.map((key) => deps[key]))
}

function input(text, ariaDisabled = null) {
  return {
    isContentEditable: true,
    textContent: text,
    getAttribute: (n) => (n === 'aria-disabled' ? ariaDisabled : null),
  }
}

function button(label) {
  return { getAttribute: (n) => (n === 'aria-label' ? label : null) }
}

/** canOwnSendButton 的完整依赖图：按真实实现逐个注入，不 mock 掉被测逻辑本身。 */
function canOwn({ quotes, el, attachments = false, inFlight = false, now = 0 }) {
  const composerInputEl = () => el
  const draftIsEmpty = extract('draftIsEmpty', { composerInputEl })
  const ui = { quotes: new Array(quotes).fill({ text: 'x' }) }
  const isPlainSendButton = extract('isPlainSendButton', {})
  const hasAttachments = extract('hasAttachments', {
    document: { querySelector: () => (attachments ? {} : null) },
  })
  const sendStillInFlight = extract('sendStillInFlight', {
    sendInFlight: inFlight,
    sendInFlightSince: 0,
    SEND_IN_FLIGHT_TIMEOUT: 5000,
    ui,
    draftIsEmpty,
    Date: { now: () => now },
  })
  return extract('canOwnSendButton', {
    ui, composerInputEl, draftIsEmpty, sendStillInFlight, isPlainSendButton, hasAttachments,
  })
}

const ZH = '发送消息'
const EN = 'Send message'

test('空草稿判定：纯空白也算空', () => {
  const draftIsEmpty = extract('draftIsEmpty', { composerInputEl: () => input('  \n\t ') })
  assert.equal(draftIsEmpty(), true)
})

test('空草稿判定：有文字、或输入区不存在时都不算空', () => {
  assert.equal(extract('draftIsEmpty', { composerInputEl: () => input('1') })(), false)
  // 拿不到输入区时返回 false：宁可不动宿主的按钮，也不要误判成空草稿
  assert.equal(extract('draftIsEmpty', { composerInputEl: () => null })(), false)
})

test('isPlainSendButton：只认宿主那个普通发送按钮', () => {
  const isPlain = extract('isPlainSendButton', {})
  assert.equal(isPlain(button(ZH)), true)
  assert.equal(isPlain(button(EN)), true)
  assert.equal(isPlain(button('停止')), false)
  assert.equal(isPlain(button('Stop')), false)
  assert.equal(isPlain(button('排队发送')), false)
  assert.equal(isPlain(button(null)), false)
})

test('canOwnSendButton：只有「有批注 + 空草稿 + 普通发送按钮 + 输入区可写 + 无附件」才接管', () => {
  const cases = [
    // [说明, 选项, 按钮 label, 期望]
    ['有批注 + 空草稿 + 中文发送按钮', { quotes: 1, el: input('') }, ZH, true],
    ['有批注 + 空草稿 + 英文发送按钮', { quotes: 1, el: input('') }, EN, true],
    ['没有待发送批注', { quotes: 0, el: input('') }, ZH, false],
    ['草稿里有用户文字', { quotes: 1, el: input('1') }, ZH, false],
    ['草稿只有空白（宿主 empty 也按 trim 判定，视为空）', { quotes: 1, el: input('  ') }, ZH, true],
    ['输入区被宿主置为不可编辑（会话只读 / 父会话离线）', { quotes: 1, el: input('', 'true') }, ZH, false],
    ['运行中的停止按钮', { quotes: 1, el: input('') }, '停止', false],
    ['运行中的停止按钮（en）', { quotes: 1, el: input('') }, 'Stop', false],
    ['运行中的排队发送按钮（label 不是普通发送）', { quotes: 1, el: input('') }, '排队发送', false],
    ['输入区不存在', { quotes: 1, el: null }, ZH, false],
    // v1.4.22 加固
    ['有附件：按钮被禁用的原因不是 empty，而是附件还在上传', { quotes: 1, el: input(''), attachments: true }, ZH, false],
    ['上一批批注还在提交途中（防双击重复发送）', { quotes: 1, el: input(''), inFlight: true }, ZH, false],
    ['提交途中但已兜底超时（解锁，避免永久卡住）', { quotes: 1, el: input(''), inFlight: true, now: 6000 }, ZH, true],
  ]
  for (const [why, opts, label, expected] of cases) {
    assert.equal(canOwn(opts)(button(label)), expected, why)
  }
})

test('sendStillInFlight：pending 被消费 / 用户开始输入 / 超时都会解锁', () => {
  const build = (opts) => extract('sendStillInFlight', {
    sendInFlight: true,
    sendInFlightSince: 0,
    SEND_IN_FLIGHT_TIMEOUT: 5000,
    ui: { quotes: new Array(opts.quotes).fill({ text: 'x' }) },
    draftIsEmpty: () => opts.empty,
    Date: { now: () => (opts.now ?? 0) },
  })
  assert.equal(build({ quotes: 1, empty: true })(), true, 'pending 未消费 + 草稿仍空 = 仍在途')
  assert.equal(build({ quotes: 0, empty: true })(), false, 'pending 已消费 = 解锁')
  assert.equal(build({ quotes: 1, empty: false })(), false, '用户开始输入 = 解锁（按钮交回宿主）')
  assert.equal(build({ quotes: 1, empty: true, now: 6000 })(), false, '兜底超时 = 解锁')
})

test('hasAttachments：用附件条的 group aria-label 判定（rail 只在有附件时渲染）', () => {
  const seen = []
  const hasAttachments = extract('hasAttachments', {
    document: { querySelector: (sel) => { seen.push(sel); return null } },
  })
  assert.equal(hasAttachments(), false)
  assert.equal(seen.length, 1)
  assert.ok(seen[0].includes('[aria-label="待发送附件"]'), 'must probe the zh label')
  assert.ok(seen[0].includes('[aria-label="Pending attachments"]'), 'must probe the en label')
  assert.ok(seen[0].includes('[data-composer-card]'), 'must be scoped to the composer card')
})

test('不再监听按钮自身的 pointerdown / click（disabled 控件收不到，旧 bug 的根因）', () => {
  assert.doesNotMatch(source, /onSendPointerDown/)
  assert.doesNotMatch(source, /onSendKeyboardClick/)
})

test('接管必须走 capture 阶段，否则宿主的 onClick 先跑', () => {
  assert.match(source, /document\.addEventListener\('click', onSendButtonActivate, true\)/)
  const fn = source.match(/function onSendButtonActivate\(e\) \{[\s\S]*?\n      \}/)
  assert.ok(fn, 'client.js should define onSendButtonActivate')
  assert.ok(fn[0].includes('e.stopPropagation()'), 'must stop the event before the host onClick')
  assert.ok(fn[0].includes('e.preventDefault()'), 'must preventDefault')
})

test('只有我们自己摘掉 disabled 的按钮才接管（不抢宿主原生可用按钮的点击）', () => {
  const fn = source.match(/function onSendButtonActivate\(e\) \{[\s\S]*?\n      \}/)
  assert.ok(fn[0].includes("getAttribute('data-dsh-ann-enabled') !== '1'"),
    'onSendButtonActivate must require our own marker attribute')
})

test('点击路径：先拼稿、再上闸、再提交；宿主同步抛错时如实提示', () => {
  const fn = source.match(/function onSendButtonActivate\(e\) \{[\s\S]*?\n      \}/)
  const attach = fn[0].indexOf('attachAndSend')
  const latch = fn[0].indexOf('sendInFlight = true')
  const submit = fn[0].indexOf("shell.submit('queue')")
  assert.ok(attach !== -1, 'must attach the annotation block')
  assert.ok(submit !== -1, 'must submit through the host service')
  assert.ok(attach < latch, 'attach must run before arming the in-flight latch')
  assert.ok(latch < submit, 'the latch must be armed before the submit (double-click window)')
  assert.ok(fn[0].includes("t('toast.sendBlocked')"), 'a sync host rejection must surface a toast')
  assert.ok(fn[0].includes('submitAttached()'), 'service-unavailable case must fall back to the DOM path')
})

test('syncSendButton：条件满足时摘 disabled 并打标记；条件消失时只按草稿状态还回去', () => {
  const fn = source.match(/function syncSendButton\(\) \{[\s\S]*?\n      \}/)
  assert.ok(fn, 'client.js should define syncSendButton')
  const body = fn[0]
  assert.ok(body.includes('button.disabled = false'), 'must clear disabled')
  assert.ok(body.includes("setAttribute('data-dsh-ann-enabled', '1')"), 'must mark the button')
  assert.ok(body.includes("removeAttribute('data-dsh-ann-enabled')"), 'must drop the mark')
  assert.ok(body.includes('if (draftIsEmpty() && isPlainSendButton(prev)) prev.disabled = true'),
    'restore must require both an empty draft and a still-plain send button')
})

test('卸载时释放按钮并断开观察器，且不把已经变成停止按钮的那个禁掉', () => {
  assert.match(source, /document\.removeEventListener\('click', onSendButtonActivate, true\)/)
  assert.match(source, /releaseSendButton\(\)/)
  assert.match(source, /sendBtnObserver\.disconnect\(\)/)
  const fn = source.match(/function releaseSendButton\(\) \{[\s\S]*?\n      \}/)
  assert.ok(fn, 'client.js should define releaseSendButton')
  assert.ok(fn[0].includes('sendInFlight = false'), 'release must drop the in-flight latch')
  assert.ok(fn[0].includes('if (draftIsEmpty() && isPlainSendButton(prev)) prev.disabled = true'),
    'release must not disable a stop button / a button the host wants enabled')
})

test('宿主重渲染会被兜住：属性观察 + 1s 周期扫描', () => {
  assert.match(source, /sendBtnObserver\.observe\(document\.documentElement/)
  assert.match(source, /attributeFilter: \['disabled', 'aria-label'\]/)
  assert.match(source, /decoTimer = setInterval\(function \(\) \{[\s\S]*?syncSendButton\(\)[\s\S]*?\}, 1000\)/)
})

test('两种语言的拒绝提示文案都在', () => {
  assert.ok(source.includes("sendBlocked: '批注未能发出"), 'zh copy missing')
  assert.ok(source.includes("sendBlocked: 'Annotation was not sent"), 'en copy missing')
})
