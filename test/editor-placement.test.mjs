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

test('角标点击把「原文矩形 + 被点到的那颗角标」交给编辑器，不重新定位原文', () => {
  const start = source.indexOf('function buildMarkers()')
  const end = source.indexOf('// ---------- 动作 ----------', start)
  const body = source.slice(start, end)
  // v1.4.28 起点角标不再另开卡片，而是在悬浮卡原位切成输入框，
  // 所以断言的是「原文矩形 + 角标」被交给悬浮卡编辑器，而不是 openEditorFor。
  assert.match(body, /showMarkerTip\(q, chipEl, quoteRect\)/)
  assert.match(body, /renderMarkerTipEditor\(tipEl, q, chipEl, quoteRect\)/)
  assert.match(body, /\}\)\(q, anchor, chip\)/, '角标锚定的是它对应的那段原文（anchor），不是角标自身')
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
  assert.match(body, /overlay\.querySelector\('\[data-ann-chip-for="/)
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

test('输入条左端动作按钮：二次编辑是垃圾桶（删除），新增批注是关闭（取消）', () => {
  const start = source.indexOf('function render()')
  const end = source.indexOf('function positionEditor(', start)
  const body = source.slice(start, end)
  // v1.4.28 把编辑卡片改成共用输入条，按钮从卡片头部挪到输入条左端，语义不变。
  assert.match(body, /ui\.editingId !== null[\s\S]{0,120}ICONS\.trash[\s\S]{0,60}t\('edit\.delete'\)/, '二次编辑是删除')
  assert.match(body, /onClick: deleteEditing/)
  assert.match(body, /ICONS\.close[\s\S]{0,120}onClick: closeToolbar/, '新增批注仍是关闭')
  assert.match(body, /danger: true/)
  assert.match(body, /function \(v\) \{ ui\.noteDraft = v \},[\s\S]{0,80}closeToolbar,/, 'Escape 取消接上 closeToolbar')
})

test('悬浮卡编辑器里也能直接删除这条批注（走 removeQuote + toast）', () => {
  const start = source.indexOf('function renderMarkerTipEditor(')
  const end = source.indexOf('function positionMarkerTip(', start)
  const body = source.slice(start, end)
  assert.match(body, /icon: ICONS\.trash,/)
  assert.match(body, /title: t\('edit\.delete'\)/)
  assert.match(body, /removeQuote\(q\.id\)/)
  assert.match(body, /showToast\(t\('toast\.deleted'\)\)/)
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
