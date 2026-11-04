// v1.8.10 · 滚动时角标不能「追着字跑」
//
// 现象：批注已提交、只剩编号角标时上下滚动，角标比文字慢半拍（有拖尾感），
// 最终位置正确。编辑态没有这个问题——因为编辑态直接用内存里的 range。
//
// 根因：旧实现每帧对每条批注调用两次 locateQuote（markersSignature 一次、
// updateMarkerPositions 一次），每次都是 querySelector + TreeWalker + 全文
// 归一化搜索，工作量大到赶不上合成器的滚动帧。
//
// 纪律：复用缓存必须**先校验**——节点还在文档里，且 Range 覆盖的文字仍等于原文
// （忽略空白）。任一不成立就重新定位，否则重渲染/编辑消息后角标会错位。
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

function fakeRange(text, connected) {
  return {
    startContainer: { isConnected: connected },
    endContainer: { isConnected: connected },
    toString: () => text,
  }
}

test('文字一致且节点在文档里 → 复用缓存（滚动不再每帧重定位）', () => {
  const liveRangeOf = extract('liveRangeOf')
  const r = fakeRange('代码', true)
  assert.equal(liveRangeOf({ text: '代码', __range: r }), r)
})

test('空白差异不算失效（Range 取回的文本可能带换行）', () => {
  const liveRangeOf = extract('liveRangeOf')
  const r = fakeRange('a\n  b', true)
  assert.equal(liveRangeOf({ text: 'a b', __range: r }), r)
})

test('文字变了 → 必须重新定位（宿主重写了同一个文本节点）', () => {
  const liveRangeOf = extract('liveRangeOf')
  assert.equal(liveRangeOf({ text: '代码', __range: fakeRange('别的', true) }), null)
})

test('节点已卸载 → 必须重新定位（React 重建了这条消息）', () => {
  const liveRangeOf = extract('liveRangeOf')
  assert.equal(liveRangeOf({ text: '代码', __range: fakeRange('代码', false) }), null)
})

test('没有缓存 / 缓存为 null → 返回 null，由 rangeFor 去定位', () => {
  const liveRangeOf = extract('liveRangeOf')
  assert.equal(liveRangeOf({ text: '代码' }), null)
  assert.equal(liveRangeOf({ text: '代码', __range: null }), null)
})

test('rangeFor 命中缓存时不调用 locateQuote，失效时才调用并写回', () => {
  let calls = 0
  const live = fakeRange('代码', true)
  const rangeFor = extract('rangeFor', {
    liveRangeOf: (q) => (q.__range && q.__range.startContainer.isConnected ? q.__range : null),
    locateQuote: () => { calls++; return fakeRange('代码', true) },
  })
  const q1 = { text: '代码', __range: live }
  assert.equal(rangeFor(q1), live)
  assert.equal(calls, 0, 'cache hit must not re-locate')

  const q2 = { text: '代码' }
  const fresh = rangeFor(q2)
  assert.equal(calls, 1)
  assert.equal(q2.__range, fresh, '定位结果写回缓存，下一帧直接用')
})
