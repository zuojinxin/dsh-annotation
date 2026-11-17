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

/** 抽出编辑卡片的两个定位函数，在受控的 window / DOM 桩里求值。
 *  positionEditorAtChip 依赖 chip.getBoundingClientRect() 与 card.offsetWidth/Height，
 *  这里用最小桩代替真实布局，只验证「写进 DOM 的坐标」与「回写 ui.pos 的坐标」是否一致。
 *
 *  注意不能复用上面的 fn()：它按 4 空格缩进匹配模块级函数，而这两个函数在 apply()
 *  内部、缩进 6 空格。这里按「起始下标 → 下一个 6 空格缩进的右花括号」切。 */
function inApply(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start > 0, `${name} should be defined`)
  const end = source.indexOf('\n      }', start)
  assert.ok(end > start, `${name} 结尾可定位`)
  return source.slice(start, end + '\n      }'.length)
}

function positionFns(ui, rects) {
  const card = {
    style: { left: '', top: '' },
    offsetWidth: rects.cardWidth,
    offsetHeight: rects.cardHeight,
  }
  const chip = {
    isConnected: true,
    getBoundingClientRect: () => rects.chip,
  }
  const window = { innerWidth: rects.innerWidth, innerHeight: rects.innerHeight }
  const fns = Function('ui', 'card', 'chip', 'window', `
    ${inApply('positionEditorAtChip')}
    ${inApply('positionEditorAboveChip')}
    return { positionEditorAtChip, positionEditorAboveChip }
  `)(ui, card, chip, window)
  return { card, chip, fns }
}

test('positionEditorAtChip 把落位结果回写 ui.pos（跟随循环与布局兜底同一套坐标）', () => {
  const ui = { pos: { left: 0, top: 0 }, composerTop: 2000, clipTop: 0, pendingChip: null,
    pendingRect: null, anchorRect: null, lastSelectionRect: null }
  const { card, chip, fns } = positionFns(ui, {
    cardWidth: 320, cardHeight: 50,
    chip: { left: 400, top: 900, width: 26, height: 18 },
    innerWidth: 1000, innerHeight: 1200,
  })
  assert.equal(fns.positionEditorAtChip(card, chip), true)
  assert.equal(card.style.left, ui.pos.left + 'px', 'DOM 坐标与 ui.pos 必须一致')
  assert.equal(card.style.top, ui.pos.top + 'px', 'DOM 坐标与 ui.pos 必须一致')
})

test('positionEditorAboveChip 走原文兜底时同样回写 ui.pos（v2.0.6 漏掉的分支）', () => {
  // 角标存在但 0 尺寸 = 被输入框遮住 / display:none：AtChip 早退 false，本函数接管落位。
  const ui = { pos: { left: 100, top: 100 }, composerTop: 2000, clipTop: 0,
    pendingChip: { isConnected: true, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }) },
    pendingRect: { left: 400, top: 940, width: 120, height: 20 },
    anchorRect: null, lastSelectionRect: null }
  const { card, fns } = positionFns(ui, {
    cardWidth: 320, cardHeight: 50,
    chip: { left: 0, top: 0, width: 0, height: 0 },
    innerWidth: 1000, innerHeight: 1200,
  })
  fns.positionEditorAboveChip(card)
  assert.equal(card.style.left, ui.pos.left + 'px',
    '只写 style 不回写 ui.pos，布局兜底会按旧坐标把卡片拽回去 = 高频跳动')
  assert.equal(card.style.top, ui.pos.top + 'px',
    '只写 style 不回写 ui.pos，布局兜底会按旧坐标把卡片拽回去 = 高频跳动')
  assert.notEqual(ui.pos.left, 100, '确实走了兜底落位，而不是沿用初始坐标')
})

test('两个定位函数对 ui.pos 的处理必须一致（同类缺陷不能只修一半）', () => {
  const at = inApply('positionEditorAtChip')
  const above = inApply('positionEditorAboveChip')
  assert.match(at, /ui\.pos = \{ left: left, top: top \}/, 'AtChip 必须回写')
  assert.match(above, /ui\.pos = \{ left: left, top: top \}/, 'AboveChip 必须回写，否则两套坐标互相覆盖')
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
  assert.match(body, /markerHover = \{ id: q\.id, grace: null, chipEl: chipEl \}/,
    'markerHover 必须记下 chipEl：mouseenter 的幂等守卫靠它判断「还是不是同一颗角标」')
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

// ---------- 角标悬停闪烁（issue #1，v2.0.8）----------
// 现象：鼠标停在数字角标上，悬浮卡快速闪烁。根因是 repeat mouseenter 每次都
// tipLayer.textContent='' + 新建 .dsh-ann-tip，而该元素带 .12s 入场动画 → 每重建一次就重播一次。

test('角标 mouseenter 必须幂等：同一批注的悬浮卡已在显示时不得重建', () => {
  const start = source.indexOf("chipEl.addEventListener('mouseenter'")
  const end = source.indexOf("chipEl.addEventListener('mouseleave'", start)
  assert.ok(start > 0 && end > start, 'mouseenter 处理器可定位')
  const handler = source.slice(start, end)
  // 判据必须是「批注 id + 卡片在文档里」，**不能**比对角标节点身份：
  // 角标层重建后新角标是新节点，chipEl === chipEl 永远为假，守卫会形同虚设。
  assert.match(handler, /markerHover\.id === q\.id/, '幂等判据必须包含批注 id')
  assert.doesNotMatch(handler, /markerHover\.chipEl === chipEl/,
    '不得用角标节点身份做幂等判据：重建后节点必换，守卫会失效（rc.3 上闪回就是这个原因）')
  assert.match(handler, /shownTip\.isConnected/, '还要求卡片仍在文档里')
  // 角标换节点后要把引用更新到当前节点
  assert.match(handler, /markerHover\.chipEl = chipEl/, '命中时应把 chipEl 引用更新为当前节点')
  assert.ok(handler.indexOf('return') < handler.indexOf('showMarkerTip(q, chipEl, quoteRect)'),
    '幂等 return 必须早于 showMarkerTip，否则仍会重建并重播动画')
})

test('角标悬浮卡必须带归属标记，否则会被 updateChip 当成残留清掉', () => {
  const tipBody = source.slice(source.indexOf('function showMarkerTip('),
    source.indexOf('function renderMarkerTipEditor('))
  assert.match(tipBody, /el\.__annotationTipOwner = 'marker'/, 'showMarkerTip 必须给卡片打归属标记')
  const chipBody = source.slice(source.indexOf('function updateChip('),
    source.indexOf('function scheduleHide('))
  assert.match(chipBody, /__annotationTipOwner === 'marker'/,
    'updateChip 的 foreign 判定必须放行 marker 归属，否则悬停卡会被清掉再重建')
})

test('观察器必须忽略插件自己的角标层，否则自我改动会再次触发观察', () => {
  const start = source.indexOf('function mutationRelevant(')
  const end = source.indexOf('function markFreshBubble(', start)
  assert.ok(start > 0 && end > start, 'mutationRelevant 可定位')
  const body = source.slice(start, end)
  for (const sel of ['data-annotation-for-dsh', 'data-annotation-overlay',
    'data-annotation-markers', 'data-annotation-chip', 'data-annotation-tip-layer']) {
    assert.ok(body.includes(`[${sel}]`), `插件自有容器 ${sel} 必须列入排除列表`)
  }
})

// ---------- 每轮 locateQuote 只扫一次（v2.0.9）----------
// renderMarkers 每帧会依次调用 markersSignature() 与 updateMarkerPositions() / buildMarkers()，
// 三者都要「批注 → Range」。locateQuote 是全文档扫描，不缓存就是每条批注每帧白扫 2~3 遍。

test('同一轮内三个子函数必须走缓存的 locateQuote，不得重复全文档扫描', () => {
  for (const name of ['markersSignature', 'updateMarkerPositions', 'buildMarkers']) {
    const start = source.indexOf(`function ${name}(`)
    assert.ok(start > 0, `${name} 可定位`)
    const end = source.indexOf('\n      }', start)
    const body = source.slice(start, end)
    assert.match(body, /locateQuoteCached\(q\)/,
      `${name} 必须用 locateQuoteCached，否则同轮重复扫描`)
    assert.doesNotMatch(body, /locateQuote\(q\.text, q\)/,
      `${name} 不得直接调 locateQuote（会绕过缓存）`)
  }
})

test('renderMarkers 负责建立并释放每轮缓存（异常也不能泄漏）', () => {
  const start = source.indexOf('function renderMarkers(')
  const end = source.indexOf('function updateMarkerPositions(', start)
  const body = source.slice(start, end)
  assert.match(body, /locateCache = new Map\(\)/, '进入时必须开新缓存')
  assert.match(body, /finally\s*\{[\s\S]{0,80}locateCache = null/,
    '必须用 finally 清空，异常时不会把过期 Range 带到下一轮')
  assert.ok(body.indexOf('locateCache = new Map()') < body.indexOf('markersSignature()'),
    '缓存必须在调用 markersSignature 之前就绪')
})

test('locateQuoteCached 在无缓存作用域时退化为直调（不影响独立入口）', () => {
  const start = source.indexOf('function locateQuoteCached(')
  assert.ok(start > 0, 'locateQuoteCached 必须存在')
  const end = source.indexOf('\n      }', start)
  const body = source.slice(start, end)
  assert.match(body, /if \(locateCache === null\) return locateQuote\(q\.text, q\)/,
    '无缓存时必须回退到直调，保证 openEditorFromList / openEditorFor 等单次入口行为不变')
  assert.match(body, /locateCache\.set\(q\.id, r\)/, '按批注 id 缓存')
})
