// v1.4.23 · 用户气泡的批注块隐藏：不能「先画出来再隐藏」
//
// 背景：decorateAll 原先只在「含 childList 的批次」里同步执行（v1.4.3 为省流式开销做的
// 优化），前提是「行插入批次本身就携带完整批注块」。但用户消息气泡可能先插入空行、再由
// React 的 commitTextUpdate 把文本写进已有的文本节点——那是 characterData 批次，原先只触发
// 500ms 限流的助手扫描，于是批注块先被画出来（用户看到原文一闪而过），要等 1s 轮询才隐藏。
// 本测试锁住新机制：发送时打开一个「期待新气泡」窗口，窗口内任何相关批次都同步隐藏。
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

const windowMs = Number((source.match(/var FRESH_BUBBLE_WINDOW = (\d+)/) || [])[1])

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

test('observer：窗口内任何相关批次都同步隐藏，不只看 childList', () => {
  assert.match(source, /if \(hasRowInsert \|\| awaitingFreshBubble\(\)\) \{/,
    'the observer must also run decorateAll for non-childList batches while awaiting a fresh bubble')
  // 流式限流路径仍在（窗口之外不受影响）
  assert.match(source, /scheduleAssistantDecorate\(\)/)
})

test('decorateAll：最新一条装饰成功后收起窗口（避免后续流式批次继续全量扫描）', () => {
  const fn = source.match(/function decorateAll\(\) \{[\s\S]*?\n      \}/)
  assert.ok(fn, 'client.js should define decorateAll')
  const body = fn[0]
  const tag = body.indexOf('attachBubbleTag(el, items)')
  const settle = body.indexOf('settleFreshBubble()')
  assert.ok(tag !== -1, 'decorateAll must attach the bubble tag')
  assert.ok(settle !== -1, 'decorateAll must settle the fresh-bubble window')
  assert.ok(tag < settle, 'settle only after a successful hide+tag')
  assert.ok(body.includes('if (i === rows.length - 1) settleFreshBubble()'),
    'only the newest row settles the window')
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
