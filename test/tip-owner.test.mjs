// 布局抖动不得清空消息悬浮面板
//
// 真因（rc.3 实测，控制台调用栈）：
//   宿主滚动 / 尺寸抖动 → onLayoutChange 的 rAF → updateChip()
//   → 无条件 tipLayer.textContent = ''；
// 而 tip 面是三处共用的（待发批注 / 消息徽章 / 回复芯片），徽章或芯片的面板
// 刚 append 就被抹掉，活不过 120ms 的淡入动画 ⇒ 悬停看起来毫无反应。
//
// 修法：消息侧面板打 __annotationTipOwner 标记，updateChip 只清没有标记的
// （即「待发批注」自己那块），别越界清理别人。
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

test('updateChip：待发批注为空时不再无条件清空共享 tip 面', () => {
  const fn = body('updateChip')
  assert.doesNotMatch(
    fn,
    /chipLayer\.style\.display = 'none'\s*\n\s*tipLayer\.textContent = ''/,
    '不能让「隐藏待发标签」顺手清空 tip 面',
  )
  assert.match(fn, /__annotationTipOwner === 'bubble'/, '要能识别徽章面板')
  assert.match(fn, /__annotationTipOwner === 'chip'/, '要能识别芯片面板')
  assert.match(fn, /if \(!foreign\) tipLayer\.textContent = ''/, '只清自己那块')
})

test('徽章与芯片的悬浮面板都带所有者标记', () => {
  assert.match(body('attachBubbleTag'), /el\.__annotationTipOwner = 'bubble'/,
    '徽章面板要标记为 bubble')
  assert.match(body('makeReplyChip'), /el\.__annotationTipOwner = 'chip'/,
    '芯片面板要标记为 chip')
})

test('待发批注侧的面板不标记（默认就是「自己那块」，仍可被 updateChip 清理）', () => {
  // 待发批注的 tip 由 chipLayer hover 写入，不应带 bubble/chip 标记，
  // 否则 updateChip 永远清不掉它，会造成残留。
  const markerCount = (source.match(/__annotationTipOwner = '(bubble|chip)'/g) || []).length
  assert.equal(markerCount, 2, '只应有徽章与芯片两处打标记')
})
