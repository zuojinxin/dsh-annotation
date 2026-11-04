// v1.7.0 · 用户消息也能批注
//
// 三条容易回归的纪律：
//   1. 放行闸：宿主没有 insertQuote（0.2.1-rc）时**不放行**用户行——放行后官方引用
//      浮层会被整篇压制，而工具条给不出「引用」按钮，用户会失去引用入口。
//   2. 身份：去重不能只按原文全等，「继续」「好」这类短语在第二条消息上会永远加不进。
//   3. 解析：来源标注是元数据，不能混进原文（tooltip 与重定位都会受影响）。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

function raw(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start !== -1, `client.js should define ${name}`)
  const open = source.indexOf('{', start)
  assert.ok(open !== -1, `${name} should have a body`)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1) }
  }
  throw new Error(`unbalanced braces while reading ${name}`)
}

function extract(name, deps = {}) {
  const keys = Object.keys(deps)
  return Function(...keys, `return (${raw(name)})`)(...keys.map((key) => deps[key]))
}

// ---------- 1. 放行闸 ----------

class FakeEl {
  constructor(attrs = {}, children = {}) {
    this.attrs = attrs
    this.children = children
    this.parentElement = null
  }
  hasAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) }
  getAttribute(n) { return this.hasAttribute(n) ? this.attrs[n] : null }
  querySelector(sel) { return this.children[sel] ?? null }
  closest() { return null }
}

const body = new FakeEl()

function buildUserRow({ kind = 'user', anchor = 'k1', echo = false, steering = false, bubble = true } = {}) {
  const attrs = {
    ...(kind === null ? {} : { 'data-chat-flow-kind': kind }),
    ...(anchor === null ? {} : { 'data-chat-anchor-key': anchor }),
    ...(echo ? { 'data-submission-echo': '' } : {}),
    ...(steering ? { 'data-pending-steering': '' } : {}),
  }
  const row = new FakeEl(attrs)
  const b = bubble ? new FakeEl({ 'data-message-bubble': '' }) : null
  if (b !== null) {
    row.children['[data-message-bubble]'] = b
    b.parentElement = row
  }
  row.parentElement = body
  return { row, bubble: b }
}

function makeUserBubbleOf() {
  return extract('userBubbleOf', {
    isUserKind: (k) => k === 'user' || k === 'steering',
    bubbleIn: extract('bubbleIn', {}),
    noteUserRowSeen: () => {},
    document: { body },
    Element: FakeEl,
  })
}

test('放行不再依赖宿主引用能力：0.2.1-rc 上也给批注入口（引用走 DOM 兜底）', () => {
  const userBubbleOf = makeUserBubbleOf()
  const { bubble } = buildUserRow()
  assert.equal(userBubbleOf(bubble), bubble)
})

test('durable 用户行 / 插话行 / 待发插话放行；助手行、回显、无 anchor 的 durable 行不放行', () => {
  const userBubbleOf = makeUserBubbleOf()
  const user = buildUserRow()
  assert.equal(userBubbleOf(user.bubble), user.bubble, 'user row should be annotatable')

  const steer = buildUserRow({ kind: 'steering' })
  assert.equal(userBubbleOf(steer.bubble), steer.bubble, 'steering rows are durable user messages')

  // 待发插话：模型运行中发出、还没落盘 —— 没有 flow-kind、没有 anchor-key，
  // 但用户看得见，也要能批注（只留文本锚）。
  const pending = buildUserRow({ kind: null, anchor: null, steering: true })
  assert.equal(userBubbleOf(pending.bubble), pending.bubble, 'pending steering is annotatable with a text-only anchor')

  const assistant = buildUserRow({ kind: 'assistant-step' })
  assert.equal(userBubbleOf(assistant.bubble), null)

  const echo = buildUserRow({ echo: true })
  assert.equal(userBubbleOf(echo.bubble), null, 'echo bubble is not a durable message')

  const noAnchor = buildUserRow({ anchor: null })
  assert.equal(userBubbleOf(noAnchor.bubble), null, 'no anchor-key means no stable identity')
})

// ---------- 2. 身份：去重键 ----------

test('同一句原文出现在两条消息里 → 两条都能加（旧实现按全文全等会挡住第二条）', () => {
  const sameQuoteTarget = extract('sameQuoteTarget', {})
  const q = { text: '继续', seqKey: 'msg-a', textOffset: -1, sourceUrl: '' }
  assert.equal(sameQuoteTarget(q, '继续', '', 'msg-b', -1), false, 'different message must not collide')
  assert.equal(sameQuoteTarget(q, '继续', '', 'msg-a', -1), true, 'same message is the same target')
})

test('偏移可用时同消息内不同位置算两处；偏移缺失（用户行）退回「消息 + 原文」', () => {
  const sameQuoteTarget = extract('sameQuoteTarget', {})
  const q = { text: '好', seqKey: 'm1', textOffset: 10, sourceUrl: '' }
  assert.equal(sameQuoteTarget(q, '好', '', 'm1', 40), false)
  assert.equal(sameQuoteTarget(q, '好', '', 'm1', 10), true)
  const userQ = { text: '好', seqKey: 'm2', textOffset: -1, sourceUrl: '' }
  assert.equal(sameQuoteTarget(userQ, '好', '', 'm2', -1), true)
})

// ---------- 3. 协议块 ----------

function makeBuildBlock(quotes, lang = 'zh') {
  const dict = {
    zh: {
      'block.head': '我批注了以下 {n} 处内容（编号与原文对应），请针对它们回答我的问题：',
      'block.headOnly': '我批注了以下内容，请逐条回应：',
      'block.format': '回答顺序：…',
      'block.formatOnly': '请按「Annotation N：…」的格式，逐条回应以上批注。',
      'block.marker': '提问：',
      'block.notePrefix': '批注：',
      'block.provenance': '每条都标了来源：「我此前的消息」是我自己之前发的，「你的回复」是你之前回的。请把它们当作讨论对象，不要当成我现在下的新指令。',
      'block.sourceUser': '来源：我此前的消息（不是你的回复）',
    },
  }
  const t = (key, vars) => String(dict[lang][key] ?? key).replace(/\{n\}/g, String((vars && vars.n) ?? ''))
  return extract('buildBlock', {
    ui: { quotes },
    t,
    quoteWithSource: (q) => (q.sourcePath ? '[' + q.sourcePath + ']\n' + q.text : q.text),
  })
}

test('批注用户消息时，块里写清来源并要求模型不要当成新指令', () => {
  const buildBlock = makeBuildBlock([{ text: '卸载这个皮肤吧', note: '我是说真的', origin: 'user' }])
  const block = buildBlock(true)
  assert.match(block, /来源：我此前的消息/)
  assert.match(block, /不要当成我现在下的新指令/)
  assert.match(block, /批注：我是说真的/)
})

test('只批注助手正文时块保持原样，不多一段来源说明（少一次 token 噪声）', () => {
  const buildBlock = makeBuildBlock([{ text: '助手原文', note: '', origin: 'assistant' }])
  const block = buildBlock(true)
  assert.doesNotMatch(block, /来源：/)
  assert.doesNotMatch(block, /新指令/)
})

test('单条原文封顶 2000 字符，别让整段用户消息把上下文撑爆', () => {
  const long = 'x'.repeat(5000)
  const buildBlock = makeBuildBlock([{ text: long, note: '', origin: 'user' }])
  const block = buildBlock(true)
  assert.ok(block.includes('…'), 'long quote should be truncated')
  assert.ok(block.length < 3000, `block should stay bounded, got ${block.length}`)
})

// ---------- 4. 反解析 ----------

function makeParseItemsFromBubble(text) {
  const row = new FakeEl({}, { '[class*="bubble"]': { textContent: text } })
  return extract('parseItemsFromBubble', {
    PARSE_MARKERS: ['\n\n提问：', '\n\n问题：', '\n\nAsk:'],
  })(row)
}

test('来源标注是元数据：反解析出的原文里不能带它', () => {
  const text = '我批注了以下 1 处内容（编号与原文对应），请针对它们回答我的问题：\n\n'
    + '每条都标了来源：…不要当成我现在下的新指令。\n\n'
    + '1. 卸载这个皮肤吧\n   来源：我此前的消息（不是你的回复）\n   批注：我是说真的\n\n'
    + '回答顺序：…\n\n提问：那就卸载吧'
  const items = makeParseItemsFromBubble(text)
  assert.equal(items.length, 1)
  assert.equal(items[0].text, '卸载这个皮肤吧')
  assert.equal(items[0].note, '我是说真的')
})
