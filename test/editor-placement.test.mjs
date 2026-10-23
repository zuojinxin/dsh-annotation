import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

function fn(name) {
  const match = source.match(new RegExp(`    function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}`))
  assert.ok(match, `${name} should be defined`)
  return match[0]
}

const WIN = { innerWidth: 1000, innerHeight: 800 }

/** placeEditorNear 现在只是 placeForSelection 的一层薄封装（两条路径共用同一条
 *  定位规则），所以测试里把两个函数一起求值，验证端到端结果。 */
function place(window) {
  return Function('window', `
    ${fn('placeForSelection')}
    ${fn('placeEditorNear')}
    return placeEditorNear
  `)(window)
}

test('编辑卡片与首次划选同源：居中于锚点、落在锚点下方 8px（v1.4.25）', () => {
  const p = place(WIN)({ left: 400, right: 500, top: 300, bottom: 316, width: 100, height: 16 }, 404, 280)
  assert.equal(p.left, 248)                 // 450 - 404/2
  assert.equal(p.top, 324)                  // 316 + 8
})

test('锚点贴近视口底部时翻到上方（与 placeForSelection 的物理必需一致）', () => {
  const p = place(WIN)({ left: 400, right: 500, top: 770, bottom: 786, width: 100, height: 16 }, 404, 280)
  assert.equal(p.top, 498)                  // 770 - 8 - 280 + 16（placeForSelection 从光标 y=786 起算）
  assert.ok(p.top >= 8 && p.top + 280 <= 800)
})

test('宽度未知时用估算宽度，不会把卡片甩出视口', () => {
  const p = place(WIN)({ left: 100, right: 120, top: 100, bottom: 116, width: 20, height: 16 }, 0, 40)
  assert.equal(p.left, 62)                  // 110 - 96/2
  assert.ok(p.left >= 8)
})

test('窄视口里横向被夹取，竖直仍贴锚点下方', () => {
  const p = place({ innerWidth: 420, innerHeight: 800 })(
    { left: 200, right: 220, top: 100, bottom: 116, width: 20, height: 16 }, 400, 280)
  assert.equal(p.left, 10)                  // 210 - 200 = 10，未触到上界 12
  assert.equal(p.top, 124)
})

test('首次划选与二次编辑用同一条规则（卡片原地接替工具条，不跳位）', () => {
  const anchor = { left: 300, right: 360, top: 200, bottom: 216, width: 60, height: 16 }
  const placeFns = Function('window', `
    ${fn('placeForSelection')}
    ${fn('placeEditorNear')}
    return { placeForSelection, placeEditorNear }
  `)(WIN)
  // 首次：工具条按「指针停在选区下沿中点」定位；二次编辑按角标矩形同样定位。
  const first = placeFns.placeForSelection(anchor, { x: 330, y: 216 }, 40, 0)
  const second = placeFns.placeEditorNear(anchor, 0, 40)
  assert.deepEqual(second, first)
})

test('角标点击在原地切成输入框：不新开卡片、不重新定位原文', () => {
  const start = source.indexOf('function buildMarkers()')
  const end = source.indexOf('function positionMarkerTip(', start)
  assert.ok(start > 0 && end > start, 'buildMarkers 与 positionMarkerTip 位置可定位')
  const body = source.slice(start, end)
  assert.match(body, /chipEl\.addEventListener\('click'/)
  assert.match(body, /renderMarkerTipEditor\(tipEl, q, chipEl, quoteRect\)/, '点角标与铅笔同一套：悬浮卡原位切编辑')
  assert.doesNotMatch(body, /openEditorFor\(/, '角标点击不再走 openEditorFor 的原文定位')
  assert.match(body, /chip\.setAttribute\('data-ann-chip-for', q\.id\)/)
})

test('openEditorFor 以原文矩形为落位基准，缺省才回退原文定位', () => {
  const start = source.indexOf('function openEditorFor(')
  const end = source.indexOf('function followEditorAnchor()', start)
  const body = source.slice(start, end)
  assert.match(body, /function openEditorFor\(q, quoteRect, anchorNode, chipRect\)/)
  assert.match(body, /quoteRect !== undefined && quoteRect !== null && quoteRect\.width > 0/)
  assert.match(body, /placeEditorNear\(rect, 0, 40\)/, '首帧用与首次划选相同的估算尺寸')
  assert.match(body, /locateQuote\(q\.text, q\)/, '只有编辑按钮路径才退回原文定位')
  assert.match(body, /ui\.editorAnchorRel = \{\s*\n?\s*dx: quoteRect\.left - chipRect\.left,/)
})

test('首次划选进编辑：卡片原地接替工具条（只消费一次 enterSync）', () => {
  const enter = source.slice(source.indexOf('function enterEditing()'), source.indexOf('function openEditorFor('))
  assert.match(enter, /ui\.enterSync = ui\.anchorRect !== null && ui\.anchorRect\.width > 0/)
  const render = source.slice(source.indexOf('function render()'), source.indexOf('function positionEditor('))
  assert.match(render, /ui\.enterSync !== null && !ui\.enterSync\.used/)
  assert.match(render, /ui\.enterSync\.used = true/)
  assert.match(render, /placeEditorNear\(ui\.enterSync\.rect, 0, 40\)/)
})

test('滚动时卡片按「原文矩形」跟随（同一参照物，不会跳到角标另一侧）', () => {
  assert.match(source, /if \(ui\.mode === 'editing' && ui\.el !== null\) \{[\s\S]{0,400}followEditorAnchor\(\)/)
  const start = source.indexOf('function followEditorAnchor()')
  const end = source.indexOf('// ---------- 批注标记 ----------', start)
  const body = source.slice(start, end)
  assert.match(body, /markerLayer\.querySelector\('\[data-ann-chip-for="/)
  assert.match(body, /var rel = ui\.editorAnchorRel/)
  assert.match(body, /left: chipRect\.left \+ rel\.dx/)
  assert.match(body, /top: chipRect\.top \+ rel\.dy/)
  assert.match(body, /return false/, '标记滚出视口时保持原位，不甩到角落')
})

test('手动拖动卡片后解除锚定（用户摆的位置优先于跟随）', () => {
  const start = source.indexOf('function makeEditorDraggable(')
  const end = source.indexOf('// ---------- 批注标记 ----------', start)
  const body = source.slice(start, end)
  assert.match(body, /ui\.editorAnchorNode = null/)
  assert.match(body, /ui\.editorAnchorId = null/)
  assert.match(body, /ui\.editorAnchorRel = null/)
})

test('关闭编辑器时清掉标记锚点与首次定位状态', () => {
  const start = source.indexOf('function closeToolbar()')
  const end = source.indexOf('// ---------- 输入框旁的批注标签', start)
  const body = source.slice(start, end)
  assert.match(body, /ui\.editorAnchorNode = null/)
  assert.match(body, /ui\.editorAnchorId = null/)
  assert.match(body, /ui\.editorAnchorRel = null/)
  assert.match(body, /ui\.enterSync = null/)
})

// ---------- v1.4.25 第二批（用户 2026-10-04 第二轮反馈） ----------

// ---------- v1.4.28：所有编辑入口统一到「悬停角标」那套定位 ----------

test('批注列表里的「编辑」走统一入口，不再「滚到原文 + 等 500ms + 原文下方弹卡」', () => {
  const start = source.indexOf('function showChipTip()')
  const end = source.indexOf('// ---------- 发送完成监听', start)
  const body = source.slice(start, end)
  assert.match(body, /openEditorFromList\(qq\)/, '铅笔按钮走统一入口')
  assert.doesNotMatch(body, /scrollBy\(/, '不再上推 260px')
  assert.doesNotMatch(body, /openEditorFor\(qq\)/, '不再从列表直接按原文定位弹卡')
})

test('openEditorFromList：角标可见直接锚定，不可见才滚动，落定后仍锚角标', () => {
  const start = source.indexOf('function openEditorFromList(')
  const end = source.indexOf('// ---------- 动作 ----------', start)
  const body = source.slice(start, end)
  assert.match(body, /if \(openEditorAtChip\(q\)\) return/, '角标可见 → 零滚动零延迟')
  assert.match(body, /scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/)
  assert.match(body, /whenScrollSettled\(range, function \(\) \{/)
  assert.match(body, /if \(!openEditorAtChip\(q\)\) openEditorFor\(q\)/, '兜底才退回原文定位')
  assert.doesNotMatch(body, /setTimeout/, '不靠固定延时等滚动')
})

test('openEditorAtChip 复用悬停那套：showMarkerTip + renderMarkerTipEditor', () => {
  const start = source.indexOf('function openEditorAtChip(')
  const end = source.indexOf('function whenScrollSettled(', start)
  const body = source.slice(start, end)
  assert.match(body, /chipForQuote\(q\.id\)/, '锚点是当前那颗角标')
  assert.match(body, /showMarkerTip\(q, chipEl, null\)/)
  assert.match(body, /renderMarkerTipEditor\(tipEl, q, chipEl, null\)/, '原地切成输入框，不另开卡片')
  assert.match(body, /markerHover = \{ id: q\.id, grace: null \}/)
})

test('chipForQuote 必须在 markerLayer 里查角标：overlay 只装高亮，查它永远拿到 null', () => {
  const start = source.indexOf('function chipForQuote(')
  const end = source.indexOf('function openEditorAtChip(', start)
  assert.ok(start > 0 && end > start, 'chipForQuote 与 openEditorAtChip 位置可定位')
  const body = source.slice(start, end)
  assert.match(body, /markerLayer\.querySelector/, '角标是 markerLayer 的子节点')
  assert.doesNotMatch(body, /overlay\.querySelector/,
    'overlay 里只有高亮块；从 overlay 查角标恒为 null，会让列表入口静默退回原文定位')
})

test('任何按 data-ann-chip-for 查角标的地方都用 markerLayer，不用 overlay', () => {
  const lines = source.split('\n').filter(function (l) {
    return l.indexOf('querySelector') !== -1 && l.indexOf('data-ann-chip-for') !== -1
  })
  assert.ok(lines.length >= 2, '至少两处按 id 认领角标')
  lines.forEach(function (l) {
    assert.doesNotMatch(l, /overlay\.querySelector/,
      '角标挂在 markerLayer（overlay 的兄弟节点），查 overlay 恒为 null：' + l.trim())
  })
})

test('「取消全部」走 chipLayer 的 pointerdown 委托，不依赖 click 命中 10px SVG 描边', () => {
  const start = source.indexOf("chipLayer.setAttribute('data-annotation-chip'")
  const end = source.indexOf('document.body.appendChild(chipLayer)', start)
  assert.ok(start > 0 && end > start, 'chipLayer 初始化位置可定位')
  const body = source.slice(start, end)
  assert.match(body, /addEventListener\('pointerdown'/)
  assert.match(body, /closest\('\[data-ann-clear-all\]'\)/)
  assert.match(body, /clearAllQuotes\(\)/)
})

test('取消全部按钮带 data-ann-clear-all，且 SVG 不吞指针事件', () => {
  const start = source.indexOf("var closeX = document.createElement('span')")
  const end = source.indexOf('chipLayer.appendChild(closeX)', start)
  assert.ok(start > 0 && end > start, 'closeX 位置可定位')
  const body = source.slice(start, end)
  assert.match(body, /setAttribute\('data-ann-clear-all'/)
  assert.match(body, /pointer-events="none"/, 'SVG 描边只有 1.3px，必须穿透到 span 才点得中')
  assert.doesNotMatch(body, /addEventListener\('click'/, '触发逻辑收敛到委托，避免双触发')
})

test('clearAllQuotes 一次做完：清清单、落盘、收标签、重绘', () => {
  const start = source.indexOf('function clearAllQuotes()')
  const end = source.indexOf('var chipLayer = document.createElement', start)
  assert.ok(start > 0 && end > start, 'clearAllQuotes 位置可定位')
  const body = source.slice(start, end)
  assert.match(body, /ui\.quotes = \[\]/)
  assert.match(body, /annotationAttached = false/)
  assert.match(body, /try \{ writeCurrentPendingQuotes\(\) \} catch/)
  assert.match(body, /tipLayer\.textContent = ''/)
  assert.match(body, /updateChip\(\)/)
  assert.match(body, /renderMarkers\(\)/)
})

test('悬浮层隐藏定时器在触发时必须复检 tipEditing（80ms 竞态会让编辑卡一闪就消失）', () => {
  const start = source.indexOf('function scheduleHide()')
  const end = source.indexOf('function cancelHide()', start)
  assert.ok(start > 0 && end > start, 'scheduleHide 与 cancelHide 位置可定位')
  const body = source.slice(start, end)
  const cb = body.slice(body.indexOf('setTimeout(function () {'))
  assert.ok(cb.length > 0, 'scheduleHide 里应有定时器')
  assert.match(cb, /if \(tipEditing\) return/,
    '回调里必须再查一次：排定时器时列表刚被抽走、80ms 后编辑卡才建好，只查一次会把它清掉')
})

test('openEditorAtChip 先撤掉待执行的隐藏定时器，再建编辑卡', () => {
  const start = source.indexOf('function openEditorAtChip(')
  const end = source.indexOf('function whenScrollSettled(', start)
  const body = source.slice(start, end)
  assert.match(body, /cancelHide\(\)/, '列表入口清空 tipLayer 会排上隐藏定时器，建卡前要撤掉')
})

test('悬停定位仍是「角标上方 8px、放不下才翻下方、夹在输入框上沿之上」', () => {
  const start = source.indexOf('function positionMarkerTip(')
  const end = source.indexOf('/** 批注 id → 当前标记层', start)
  assert.ok(start > 0 && end > start, 'positionMarkerTip 与 chipForQuote 位置可定位')
  const body = source.slice(start, end)
  assert.match(body, /var top = cr\.top - h - 8/)
  assert.match(body, /if \(top < 8\) top = cr\.bottom \+ 8/)
  assert.match(body, /Math\.min\(top, maxTop\)/)
})

test('删除入口在角标悬浮卡（垃圾桶），编辑卡片本身不再画头部按钮', () => {
  const tip = source.slice(source.indexOf('function showMarkerTip('), source.indexOf('function renderMarkerTipEditor('))
  assert.match(tip, /ICONS\.trash, t\('edit\.delete'\)/)
  assert.match(tip, /removeQuote\(q\.id\)/)
  const render = source.slice(source.indexOf('function render()'), source.indexOf('function positionEditor('))
  assert.doesNotMatch(render, /ICONS\.trash/, '编辑卡片不再画头部垃圾桶')
})

test('头部垃圾桶真的删除批注（走 removeQuote，不是只关卡片）', () => {
  const start = source.indexOf('function deleteEditing()')
  const end = source.indexOf('function removeQuote(', start)
  const body = source.slice(start, end)
  assert.match(body, /var id = ui\.editingId/)
  assert.match(body, /removeQuote\(id\)/)
  assert.match(body, /showToast\(t\('toast\.deleted'\)\)/)
})

test('保存按钮文案缩短为「保存」/「Save」，删除提示两语齐全', () => {
  assert.match(source, /save: '保存',/)
  assert.match(source, /save: 'Save',/)
  assert.match(source, /delete: '删除此批注',/)
  assert.match(source, /delete: 'Delete this annotation',/)
  assert.match(source, /deleted: '已删除该批注',/)
  assert.match(source, /deleted: 'Annotation deleted',/)
})

test('垃圾桶 hover 用错误色（与取消在视觉上区分开）', () => {
  assert.match(source, /\.dsh-ann-icon-danger:hover \{[\s\S]{0,200}state-error-primary/)
})
