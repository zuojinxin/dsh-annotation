// v1.4.21 · 空草稿纯批注的发送按钮（结构 + 决策守卫）
//
// 背景：宿主 InputBar 的发送按钮在草稿为空时是 disabled 的
//   empty = draft.trim() === '' && attachments.length === 0
//   primaryDisabled = primaryStops ? stop === undefined : empty || disabled || machineBusy || uploadsPending
// 而浏览器不会给 disabled 的表单控件派发 pointer/mouse 事件，所以「监听按钮上的
// pointerdown」永远等不到事件（v1.4.20 及之前的写法，注释里的假设是错的）。
// 本测试锁住新的接管策略：主动摘 disabled + capture 阶段接管 click。
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

/** canOwnSendButton 依赖 composerInputEl 与 draftIsEmpty，两者一起注入。 */
function canOwn({ quotes, el }) {
  const composerInputEl = () => el
  return extract('canOwnSendButton', {
    ui: { quotes: new Array(quotes).fill({ text: 'x' }) },
    composerInputEl,
    draftIsEmpty: extract('draftIsEmpty', { composerInputEl }),
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

test('canOwnSendButton：只有「有批注 + 空草稿 + 普通发送按钮 + 输入区可写」才接管', () => {
  const cases = [
    // [说明, quotes, 按钮 label, 输入区, 期望]
    ['有批注 + 空草稿 + 中文发送按钮', 1, ZH, input(''), true],
    ['有批注 + 空草稿 + 英文发送按钮', 1, EN, input(''), true],
    ['没有待发送批注', 0, ZH, input(''), false],
    ['草稿里有用户文字', 1, ZH, input('1'), false],
    ['草稿只有空白（宿主 empty 也按 trim 判定，视为空）', 1, ZH, input('  '), true],
    ['输入区被宿主置为不可编辑（会话只读 / 父会话离线）', 1, ZH, input('', 'true'), false],
    ['运行中的停止按钮', 1, '停止', input(''), false],
    ['运行中的停止按钮（en）', 1, 'Stop', input(''), false],
    ['运行中的排队发送按钮（label 不是普通发送）', 1, '排队发送', input(''), false],
    ['输入区不存在', 1, ZH, null, false],
  ]
  for (const [why, quotes, label, el, expected] of cases) {
    assert.equal(canOwn({ quotes, el })(button(label)), expected, why)
  }
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

test('点击路径：先拼稿、再提交，且宿主拒绝时如实提示而不是假装成功', () => {
  const fn = source.match(/function onSendButtonActivate\(e\) \{[\s\S]*?\n      \}/)
  const attach = fn[0].indexOf('attachAndSend')
  const submit = fn[0].indexOf("shell.submit('queue')")
  assert.ok(attach !== -1, 'must attach the annotation block')
  assert.ok(submit !== -1, 'must submit through the host service')
  assert.ok(attach < submit, 'attach must run before submit')
  assert.ok(fn[0].includes("t('toast.sendBlocked')"),
    'a host rejection (e.g. uploadsPending) must surface a toast')
  assert.ok(fn[0].includes('submitAttached()'),
    'service-unavailable case must fall back to the DOM submit path')
})

test('syncSendButton：条件满足时摘 disabled 并打标记；条件消失时只按草稿状态还回去', () => {
  const fn = source.match(/function syncSendButton\(\) \{[\s\S]*?\n      \}/)
  assert.ok(fn, 'client.js should define syncSendButton')
  const body = fn[0]
  assert.ok(body.includes('button.disabled = false'), 'must clear disabled')
  assert.ok(body.includes("setAttribute('data-dsh-ann-enabled', '1')"), 'must mark the button')
  assert.ok(body.includes("removeAttribute('data-dsh-ann-enabled')"), 'must drop the mark')
  const restore = body.indexOf('prev.disabled = true')
  const guard = body.lastIndexOf('draftIsEmpty()')
  assert.ok(restore !== -1, 'must restore disabled')
  assert.ok(guard !== -1 && guard < restore,
    'must not clobber the host state when the user has typed something in the meantime')
})

test('宿主重渲染会被兜住：属性观察 + 1s 周期扫描', () => {
  assert.match(source, /sendBtnObserver\.observe\(document\.documentElement/)
  assert.match(source, /attributeFilter: \['disabled', 'aria-label'\]/)
  assert.match(source, /decoTimer = setInterval\(function \(\) \{[\s\S]*?syncSendButton\(\)[\s\S]*?\}, 1000\)/)
})

test('卸载时释放按钮并断开观察器（不留「看起来可用、点了没反应」的按钮）', () => {
  assert.match(source, /document\.removeEventListener\('click', onSendButtonActivate, true\)/)
  assert.match(source, /releaseSendButton\(\)/)
  assert.match(source, /sendBtnObserver\.disconnect\(\)/)
  const fn = source.match(/function releaseSendButton\(\) \{[\s\S]*?\n      \}/)
  assert.ok(fn, 'client.js should define releaseSendButton')
  assert.ok(fn[0].includes('if (draftIsEmpty()) prev.disabled = true'),
    'release must not disable a button the host wants enabled')
})

test('两种语言的拒绝提示文案都在', () => {
  assert.ok(source.includes("sendBlocked: '批注未能发出"), 'zh copy missing')
  assert.ok(source.includes("sendBlocked: 'Annotation was not sent"), 'en copy missing')
})
