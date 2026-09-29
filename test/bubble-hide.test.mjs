// v1.4.24 · 用户气泡的批注块隐藏：不能「先画出来再隐藏」
//
// 背景（三轮踩坑的记录，真因由用户实测确认）：
//   v1.4.3  的优化假设「行插入批次本身就携带完整批注块」，所以只在含 childList 的批次里同步
//           跑 decorateAll，其余批次只触发 500ms 限流的助手扫描。
//   v1.4.23 加了「期待新气泡」窗口，但写成「第一次隐藏成功就收窗」——隐藏完的下一帧被重渲染
//           覆盖回去时窗口已经关了。窗口方向对，收尾错。
//   v1.4.24 **真因**：宿主的提交回显气泡（dsh-client-ui-chat 的 PendingSubmissionBubble，
//           `[data-submission-echo]`）从点击那一刻就显示草稿原文，而 ChatNodeList 把
//           pendingRows 直接追加在列表末尾、没有 ChatNodeSeat 包装，所以它没有
//           data-chat-flow-kind → allMessageRows() 永远看不到它。插件从来没管过这个元素。
//           修法：hideDockEchoBlocks() 用与普通气泡同一条路径处理它（反解析 → 隐藏 → 贴标签），
//           并让 hideAnnotationBlock 自己落到 [class*="bubble"] 上（把整个 userRow 当容器时，
//           行里的时间戳会让「纯批注」的严格判定失败——这是本版初版仍闪的原因）。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/** 取函数源码：从定义处扫到配对的右花括号。
 *  不能用 `[\s\S]*?\n      \}` 那种惰性正则——单行函数体内没有换行，它会一路吞到后面
 *  某个函数的结尾，把无关代码也带进来。 */
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

const windowMs = Number((source.match(/var FRESH_BUBBLE_WINDOW = (\d+)/) || [])[1])
const BLOCK = 'BLOCK'   // 桩：含此串即视为「带批注块」

test('窗口常量存在且有界（别把它调成「永远开着」，那会把流式开销还回去）', () => {
  assert.ok(Number.isFinite(windowMs), 'FRESH_BUBBLE_WINDOW must be a literal number')
  assert.ok(windowMs > 0 && windowMs <= 5000, `window must stay short, got ${windowMs}ms`)
})

test('markFreshBubble / awaitingFreshBubble / settleFreshBubble 共用一个有界窗口', () => {
  let now = 1000
  const trio = Function('Date', `
    var freshBubbleUntil = 0
    var FRESH_BUBBLE_WINDOW = ${windowMs}
    ${raw('markFreshBubble')}
    ${raw('awaitingFreshBubble')}
    ${raw('settleFreshBubble')}
    return {
      markFreshBubble: markFreshBubble,
      awaitingFreshBubble: awaitingFreshBubble,
      settleFreshBubble: settleFreshBubble,
      raw: function () { return freshBubbleUntil }
    }
  `)({ now: () => now })

  assert.equal(trio.awaitingFreshBubble(), false, '默认不在窗口内')
  trio.markFreshBubble()
  assert.equal(trio.awaitingFreshBubble(), true, '标记后进入窗口')
  assert.equal(trio.raw(), 1000 + windowMs, '窗口长度 = FRESH_BUBBLE_WINDOW')
  now = 1000 + windowMs
  assert.equal(trio.awaitingFreshBubble(), false, '到点即过期（用 < 而非 <=）')
  trio.markFreshBubble()
  assert.equal(trio.awaitingFreshBubble(), true)
  trio.settleFreshBubble()
  assert.equal(trio.awaitingFreshBubble(), false, 'settle 立即收起')
  assert.equal(trio.raw(), 0)
})

test('observer：窗口内只要「又有批注块可见」就同步隐藏，不只看 childList', () => {
  assert.match(source, /if \(hasRowInsert \|\| \(awaitingFreshBubble\(\) && freshBubbleNeedsHide\(\)\)\) \{/,
    'the observer must re-run decorateAll while a fresh bubble is awaited')
  // 流式限流路径仍在（窗口之外不受影响）
  assert.match(source, /scheduleAssistantDecorate\(\)/)
})

test('freshBubbleNeedsHide：最新一行没标签且带块 → true；有标签 / 无块 / 无行 → false', () => {
  const build = ({ rows = [], echoes = [] }) => extract('freshBubbleNeedsHide', {
    hasAnnotationBlock: (t) => (t || '').includes(BLOCK),
    allMessageRows: () => rows,
    document: { querySelectorAll: (sel) => (sel === '[data-submission-echo]' ? echoes : []) },
  })
  const row = ({ pill = false, text = '', bubble = true }) => ({
    querySelector: (sel) => {
      if (sel === '[data-annotation-bubble-tag]') return pill ? {} : null
      if (sel === '[class*="bubble"]') return bubble ? { textContent: text } : null
      return null
    },
  })

  assert.equal(build({ rows: [row({ text: BLOCK })] })(), true, '最新行有块、没标签 → 需要补刀')
  assert.equal(build({ rows: [row({ text: BLOCK, pill: true })] })(), false, '已经有标签 → 不重复处理')
  assert.equal(build({ rows: [row({ text: '普通消息' })] })(), false, '没有块 → 不扫')
  assert.equal(build({ rows: [row({ bubble: false })] })(), false, '拿不到气泡 → 不扫')
  assert.equal(build({ rows: [] })(), false, '没有消息行 → 不扫')
  // 只看最新一行：老行里的块不该让窗口内每批都全量扫描
  assert.equal(build({ rows: [row({ text: BLOCK }), row({ text: '普通消息' })] })(), false,
    '只看最新一行（老行的块由 1s 轮询/行插入批次覆盖）')
  assert.equal(build({ echoes: [{ textContent: BLOCK }] })(), true, '队列 dock 的回显行带块 → 需要处理')
})

test('decorateAll：处理队列 dock 回显行，且不再「首次隐藏成功就收窗」', () => {
  const fn = source.match(/function decorateAll\(\) \{[\s\S]*?\n      \}/)
  assert.ok(fn, 'client.js should define decorateAll')
  const body = fn[0]
  assert.ok(body.includes('hideDockEchoBlocks()'), 'decorateAll must also clean the dock echo rows')
  assert.ok(!body.includes('settleFreshBubble()'),
    'decorateAll must NOT close the window on the first hide (v1.4.23 的错就错在这里)')
  const sweep = body.indexOf('sweepStrayLayers()')
  const dock = body.indexOf('hideDockEchoBlocks()')
  const rows = body.indexOf('var rows = allMessageRows()')
  assert.ok(sweep < dock && dock < rows, 'dock 清理要在行扫描之前')
})

test('hideAnnotationBlock 默认落在气泡元素上，而不是整行（行里的时间戳会让判定失败）', () => {
  assert.match(source, /function hideAnnotationBlock\(row, container\) \{/)
  assert.match(source, /var bubble = container !== undefined \? container : row\.querySelector\('\[class\*="bubble"\]'\)/)
})

test('hideDockEchoBlocks：反解析 → 隐藏 → 贴标签，与普通气泡同一套处理', () => {
  const calls = []
  const row = (text, { pill = false } = {}) => ({
    textContent: text,
    querySelector: (sel) => (sel === '[data-annotation-bubble-tag]' && pill ? {} : null),
  })
  const rows = [row(BLOCK), row('普通预览'), row(BLOCK, { pill: true })]
  const hideDockEchoBlocks = extract('hideDockEchoBlocks', {
    hasAnnotationBlock: (t) => (t || '').includes(BLOCK),
    document: { querySelectorAll: (sel) => (sel === '[data-submission-echo]' ? rows : []) },
    parseItemsFromBubble: (r) => { calls.push(['parse', r.textContent]); return [{ text: 'x' }] },
    hideAnnotationBlock: (r) => { calls.push(['hide', r.textContent]); return true },
    attachBubbleTag: (r, items) => { calls.push(['tag', r.textContent, items.length]) },
  })
  hideDockEchoBlocks()
  assert.deepEqual(calls, [
    ['parse', BLOCK], ['hide', BLOCK], ['tag', BLOCK, 1],
  ], '只处理「有块且没贴过标签」的那一行，且顺序是 反解析 → 隐藏 → 贴标签')
})

test('hideDockEchoBlocks：隐藏失败时不贴标签（暂存数据不提前消费）', () => {
  const calls = []
  const hideDockEchoBlocks = extract('hideDockEchoBlocks', {
    hasAnnotationBlock: () => true,
    document: { querySelectorAll: () => [{ textContent: BLOCK, querySelector: () => null }] },
    parseItemsFromBubble: () => [{ text: 'x' }],
    hideAnnotationBlock: () => false,
    attachBubbleTag: () => { calls.push('tag') },
  })
  hideDockEchoBlocks()
  assert.deepEqual(calls, [], '内容未渲染完 → 留给下一轮')
})

test('纯批注的判定不要求「整段文本恰好等于块本身」（容器里可能夹着别的东西）', () => {
  // 老实现是 full.indexOf(headOnly) === 0 && full.trimEnd().endsWith(formatOnly)，
  // 只要容器里有时间戳之类的文本就会失败 → 回显气泡永远隐藏不掉（v1.4.24 的真因）。
  assert.doesNotMatch(source, /full\.trimEnd\(\)\.endsWith\(dictVal\(lang, 'block\.formatOnly'\)\)/)
  assert.match(source, /var hi = full\.indexOf\(hStr\)/)
  assert.match(source, /var fi = full\.indexOf\(fStr, hi \+ hStr\.length\)/)
  assert.match(source, /cutRange\(nodes, headIdx, tailEnd\)/)
})

test('发送路径都会打开窗口：草稿提交 + 两条拼稿路径', () => {
  const clear = source.match(/function clearSentQuotes\(\) \{[\s\S]*?\n      \}/)
  assert.ok(clear, 'client.js should define clearSentQuotes')
  assert.ok(clear[0].includes('markFreshBubble()'), 'clearSentQuotes (draft committed) must mark')

  const attach = source.match(/function attachAndSend\(e\) \{[\s\S]*?\n      \}/)
  assert.ok(attach, 'client.js should define attachAndSend')
  const marks = attach[0].match(/markFreshBubble\(\)/g) || []
  assert.equal(marks.length, 2, 'both the service path and the DOM fallback must mark')
  const service = attach[0].indexOf('shell.setDraft')
  const dom = attach[0].indexOf('domAttachBlock(buildBlock')
  assert.ok(service !== -1 && dom !== -1)
  assert.ok(attach[0].indexOf('markFreshBubble()') > service, 'service path marks after setDraft')
  assert.ok(attach[0].lastIndexOf('markFreshBubble()') > dom, 'DOM path marks after the injection')
})

test('临时的帧级自检已经拆干净（不留诊断代码在正式版里）', () => {
  assert.doesNotMatch(source, /probeVisibleKind|startProbe|probeRaf|\[自检\]/)
})
