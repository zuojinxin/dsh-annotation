// v1.8.12 · 卸载必须干净
//
// 两条纪律：
//   1. 插件自己的定时器 / 监听器，teardown 里必须清掉。漏一个的后果不是「多占一点
//      内存」，而是「禁用插件后它还在后台跑」——500ms 轮询会继续读 localStorage、
//      切会话时用旧内存数据写盘、并重新订阅输入。
//   2. 贴进宿主 DOM 的装饰也要收掉，否则禁用插件后消息上还挂着「批注 ×N」标签。
//      但回复芯片是「删掉原文再插入」的节点，直接 remove 会让那段文字永久缺失，
//      必须还原成文本。
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

const teardown = raw('teardown')

test('会话切换轮询存了句柄，并在 teardown 里清掉', () => {
  assert.match(source, /var sessionPollTimer = setInterval\(/,
    'session poll interval must be stored (otherwise teardown cannot clear it)')
  assert.match(teardown, /clearInterval\(sessionPollTimer\)/,
    'teardown must clear the session poll interval')
})

test('每个 document / window 级监听器都在 teardown 里被移除', () => {
  const registered = [...source.matchAll(/(?:document|window)\.addEventListener\(\s*'([A-Za-z]+)'/g)]
    .map((m) => m[1])
  const unique = [...new Set(registered)]
  assert.ok(unique.length >= 8, `expected a real listener set, got ${unique.length}`)
  for (const name of unique) {
    assert.ok(teardown.includes(`removeEventListener('${name}'`),
      `teardown must remove document/window listener: ${name}`)
  }
})

test('贴进宿主 DOM 的气泡标签在 teardown 里被移除', () => {
  assert.match(teardown, /\[data-annotation-bubble-tag\]/)
  assert.match(teardown, /\.remove\(\)/)
})

test('回复芯片还原成文本，而不是直接删除（否则那段文字会消失）', () => {
  assert.match(teardown, /\[data-annotation-reply-chip\]/)
  assert.match(teardown, /replaceChild\(/, 'reply chips replaced the original text, so restore it')
})

test('回复芯片的还原文本保留编号与冒号', () => {
  assert.match(teardown, /label \+ '：'/, 'restored text should read "Annotation N："')
})
