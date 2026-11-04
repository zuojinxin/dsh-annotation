// 芯片数据不再依赖 DOM 里现存的徽章
//
// 真因（两端实测）：虚拟化只渲染最近几轮——100 个 [data-chat-flow-kind] 行里
// user 只有 6 个，徽章数为 0。带批注的用户行连同行上的「批注 ×N」徽章一起
// 不在 DOM 里；而批注块已被 hideAnnotationBlock 隐藏，hasAnnotationBlock 恒为
// false，徽章再也贴不回去。findPrevAnnotationItems() 往回找
// [data-annotation-bubble-tag] 永远拿不到 → 芯片只能显示占位内容。
//
// 修法：贴徽章时按 data-chat-turn 留一份条目数据；芯片查找先命中缓存；
// decorateAll 每轮按缓存把丢失的徽章补回去；会话切换时清空（turn 号跨会话不可比）。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/** 取具名函数体，依赖仓库统一的 6 空格缩进收尾。 */
function body(name) {
  const m = source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n      \\}`))
  assert.ok(m, `client.js should define ${name}`)
  return m[0]
}

test('贴徽章时按 turn 留一份条目数据', () => {
  const fn = body('attachBubbleTag')
  assert.match(fn, /row\.getAttribute\('data-chat-turn'\)/, '要从行上取 turn 号')
  assert.match(fn, /turnItems\.set\(turnKey, items\)/, '要写入缓存')
})

test('芯片查找先命中 turn 缓存，再回退 DOM 回溯', () => {
  const fn = body('findPrevAnnotationItems')
  const cached = fn.indexOf('turnItems.get(')
  const dom = fn.indexOf('allMessageRows()')
  assert.ok(cached !== -1, '要先查缓存')
  assert.ok(dom !== -1, '保留 DOM 回退路径')
  assert.ok(cached < dom, '缓存必须优先于 DOM 回溯')
})

test('decorateAll 按缓存把丢失的徽章补回去，且只补用户消息行', () => {
  const fn = body('decorateAll')
  assert.match(fn, /data-chat-flow-kind'\) === 'user'/, '只恢复 user 行')
  assert.match(fn, /turnItems\.has\(cachedTurn\)/, '要有缓存才恢复')
  assert.match(fn, /attachBubbleTag\(el, turnItems\.get\(cachedTurn\)\)/, '走同一套贴徽章逻辑')
})

test('会话切换清空缓存：不同会话的 turn 号不可混用', () => {
  assert.match(source, /pendingDeco\.length = 0\s*\n\s*turnItems\.clear\(\)/,
    '会话切换时 pendingDeco 与 turnItems 一起清')
})
