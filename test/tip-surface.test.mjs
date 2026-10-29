// v1.6.1 · 徽章/芯片悬停必须服务「活着的」tip 面
//
// 真因（用户实测复现）：宿主 fiber 重建 → 第二个实例 apply → 开头调旧实例 teardown()，
// 把旧 tipLayer 从 body 摘除；但旧实例贴过的「批注 ×N」徽章与回复里的「Annotation N」
// 芯片仍留在文档里，handler 闭包写的是已脱离文档的旧面板 → 悬停静默无反应。
// 新实例 decorateAll 又因「已有 tag」(:3998) + 批注块正文已被剪掉（hasAnnotationBlock 假）
// 永不再贴 ⇒ 徽章永久失效直到刷新。
//
// 修法：tip 面通过 window.__dshAnnotationTip 共享，任何存活实例都能服务旧徽章；
// 宽限定时器只清自己放进去的那块，免得 A→B 快速切换时把别人的 tip 清掉。
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

/** 取具名函数体（含首行），依赖仓库统一的 6 空格缩进收尾。 */
function body(name) {
  const m = source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n      \\}`))
  assert.ok(m, `client.js should define ${name}`)
  return m[0]
}

const liveTip = (globalTip, fallback) => Function('window', 'fallback', `
  var tipLayer = fallback
  ${raw('liveTip')}
  return liveTip
`)({ __dshAnnotationTip: globalTip }, fallback)

const connected = () => ({ isConnected: true })

test('liveTip：全局指针还挂在文档上就用它（服务别的实例贴的旧徽章）', () => {
  const shared = connected()
  const fallback = connected()
  assert.equal(liveTip(shared, 'fallback')(), shared)
})

test('liveTip：指针为空 / 已脱离文档时回退本实例面板', () => {
  const fallback = connected()
  assert.equal(liveTip(null, 'fallback')(), 'fallback', '指针为空 → 回退')
  assert.equal(liveTip(undefined, 'fallback')(), 'fallback', '指针未初始化 → 回退')
  assert.equal(liveTip({ isConnected: false }, 'fallback')(), 'fallback', '旧面板已摘除 → 回退')
})

test('tipLayer 建好后登记为全局共享面', () => {
  assert.match(source, /window\.__dshAnnotationTip = tipLayer/)
  const reg = source.indexOf('window.__dshAnnotationTip = tipLayer')
  const append = source.indexOf("document.body.appendChild(tipLayer)")
  assert.ok(append !== -1 && append < reg, '先挂到 body 再登记')
})

test('徽章与回复芯片的悬停都走 liveTip()，不再直接写闭包面板', () => {
  const tag = body('attachBubbleTag')
  assert.match(tag, /var surface = liveTip\(\)/, '徽章悬停必须取当前活着的面板')
  assert.ok(tag.includes('surface.appendChild(el)'), '内容写进活着的面板')
  assert.doesNotMatch(tag, /tipLayer\.(textContent|appendChild)/, '不能再往闭包里的旧面板写')

  const chip = body('makeReplyChip')
  assert.match(chip, /var surface = liveTip\(\)/)
  assert.ok(chip.includes('surface.appendChild(el)'))
  assert.doesNotMatch(chip, /tipLayer\.(textContent|appendChild)/)
})

test('面板换过就重挂 keep/hide，并撤掉挂在旧面板上的那一对（否则 tip 永不隐藏）', () => {
  for (const name of ['attachBubbleTag', 'makeReplyChip']) {
    const fn = body(name)
    assert.match(fn, /if \(tipBound !== surface\) \{/, `${name} 换面要重挂监听`)
    assert.match(fn, /tipBound\.removeEventListener\('mouseenter', /, `${name} 要撤旧 mouseenter`)
    assert.match(fn, /tipBound\.removeEventListener\('mouseleave', /, `${name} 要撤旧 mouseleave`)
    assert.match(fn, /tipBound = surface/, `${name} 记下当前面板`)
    assert.equal((fn.match(/surface\.addEventListener\('mouseenter', /g) || []).length, 1,
      `${name} 每次悬停只能挂一份 mouseenter（老实现每次悬停都 addEventListener）`)
  }
})

test('80ms 宽限只清自己放进去的那块（A→B 切换不能互相踩）', () => {
  for (const name of ['attachBubbleTag', 'makeReplyChip']) {
    const fn = body(name)
    assert.match(fn, /var tipOwned = null/, `${name} 要记住自己放进去的 tip 节点`)
    assert.match(fn, /tipOwned = el/, `${name} 放进去后要记下来`)
    assert.match(fn, /if \(tipOwned !== null && s\.firstElementChild === tipOwned\) s\.textContent = ''/,
      `${name} 定时器只能清自己那块`)
    assert.doesNotMatch(fn, /liveTip\(\)\.textContent = ''\n/, `${name} 不能无条件清空共享面`)
  }
})

test('teardown 只在仍指向本实例面板时才清全局指针（延迟 dispose 不能误清新实例）', () => {
  const fn = body('teardown')
  assert.match(fn, /if \(window\.__dshAnnotationTip === tipLayer\) window\.__dshAnnotationTip = null/)
  const clear = fn.indexOf('window.__dshAnnotationTip === tipLayer')
  const remove = fn.indexOf('tipLayer.remove()')
  assert.ok(clear !== -1 && remove !== -1 && clear < remove, '先判身份再摘面板')
})
