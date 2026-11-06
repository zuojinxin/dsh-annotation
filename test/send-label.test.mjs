// v2.0.3 · 运行中的主提交键（排队发送 / 插话发送）也必须被认出来
//
// 真因（2026-11-06 桌面端 rc.1 实测复现）：宿主的 InputBar 主按钮文案不是固定的，
// 见 dsh-client-ui-conversation/lib/client.js:
//   primaryLabel = primaryStops ? 停止生成
//     : sending ? 正在发送消息
//     : running && steeringAvailable && !disabled && !uploadsPending && plainMessageDraft
//         ? t(primarySubmitMode === 'steer' ? '插话发送' : '排队发送')
//         : t('发送消息')
// 旧实现只认「发送消息 / Send message」，于是「运行中 + 有正文」时点那颗
// 「排队发送 / 插话发送」按钮不被插件接管：正文照发、批注留在输入框。
// 回车路径不依赖按钮文案，所以只坏了「点按钮发送」这一条。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

function body(name) {
  const m = source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n      \\}`))
  assert.ok(m, `client.js should define ${name}`)
  return m[0]
}

test('isSendLabel 覆盖 发送消息 / 排队发送 / 插话发送（中英文）', () => {
  const fn = body('isSendLabel')
  for (const label of ['发送消息', '排队发送', '插话发送', 'Send message', 'Queue message', 'Steer message']) {
    assert.ok(fn.includes(`'${label}'`), `isSendLabel 要认 ${label}`)
  }
})

test('sendButtonOf 用 isSendLabel 判定，而不是只比「发送消息」', () => {
  const fn = body('sendButtonOf')
  assert.match(fn, /isSendLabel\(button\.getAttribute\('aria-label'\)\)/, '要委托给 isSendLabel')
  assert.doesNotMatch(fn, /=== '发送消息'/, '不能再有只认「发送消息」的内联判断')
})

test('isPlainSendButton 保持窄判定：只认空闲态「发送消息」，不碰运行中的排队/插话键', () => {
  const fn = body('isPlainSendButton')
  assert.match(fn, /=== '发送消息'/, '只认发送消息')
  assert.doesNotMatch(fn, /排队发送|插话发送/, '不能把运行中的键也当成可接管的普通发送键')
})

test('syncSendButton / hasPlainSendButton 走 findSendButton，避免只查两个文案', () => {
  assert.match(body('syncSendButton'), /var button = findSendButton\(\)/)
  assert.match(body('hasPlainSendButton'), /findSendButton\(\) !== null/)
})

test('SEND_LABEL_SELECTOR 包含排队/插话文案', () => {
  const at = source.indexOf('var SEND_LABEL_SELECTOR')
  assert.ok(at !== -1, 'SEND_LABEL_SELECTOR 应有定义')
  const chunk = source.slice(at, at + 500)
  for (const label of ['发送消息', '排队发送', '插话发送', 'Send message', 'Queue message', 'Steer message']) {
    assert.ok(chunk.includes(label), `选择器要含 ${label}`)
  }
})
