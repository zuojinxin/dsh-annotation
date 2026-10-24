import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

const match = source.match(/function conversationClip\(\) \{[\s\S]*?\n    \}/)
assert.ok(match, 'client.js should define conversationClip()')

const clipFactory = Function(
  'document',
  'window',
  'allMessageRows',
  'getComputedStyle',
  `return (${match[0]})`,
)

/** 在假宿主上求值：client.js 里的 conversationClip 直接读这三个全局。 */
function conversationClip(doc, win, rows, getComputedStyle) {
  return clipFactory(doc, win, rows, getComputedStyle)()
}

/** 最小假宿主：会话滚动容器 + 正文根节点。 */
function makeHost({ scroller, flow, rows = [], chain = [] }) {
  const body = { nodeName: 'BODY' }
  const flowEl = flow === undefined
    ? null
    : {
      closest: (sel) => (sel === '[data-conversation-scroll]' ? (scroller || null) : null),
      parentElement: chain.length > 0 ? chain[0] : body,
    }
  const doc = {
    body,
    querySelector: (sel) => {
      if (sel === '[data-chat-flow]') return flowEl
      if (sel === '[data-conversation-scroll]') return scroller || null
      return null
    },
  }
  return { doc, body }
}

const win = { innerHeight: 922 }

test('会话滚动容器存在时按它的可视框裁剪（顶部页签栏、底部输入框都不算会话视图）', () => {
  const scroller = { getBoundingClientRect: () => ({ top: 56, bottom: 700, height: 644 }) }
  const { doc } = makeHost({ scroller, flow: {} })
  assert.deepEqual(conversationClip(doc, win, () => [], () => ({ overflowY: 'visible' })), {
    top: 56,
    bottom: 700,
  })
})

test('没有滚动容器时退回整窗（旧版行为不变）', () => {
  const { doc } = makeHost({ flow: {} })
  assert.deepEqual(conversationClip(doc, win, () => [], () => ({ overflowY: 'visible' })), {
    top: 0,
    bottom: 922,
  })
})

test('滚动容器高度为 0（未布局）时退回整窗，避免把角标层裁成 0', () => {
  const scroller = { getBoundingClientRect: () => ({ top: 56, bottom: 56, height: 0 }) }
  const { doc } = makeHost({ scroller, flow: {} })
  assert.deepEqual(conversationClip(doc, win, () => [], () => ({ overflowY: 'visible' })), {
    top: 0,
    bottom: 922,
  })
})

test('宿主去掉 data-conversation-scroll 后按祖先 overflow-y 兜底', () => {
  const scrollEl = {
    nodeName: 'DIV',
    getBoundingClientRect: () => ({ top: 100, bottom: 800, height: 700 }),
  }
  const { doc, body } = makeHost({ flow: {}, chain: [scrollEl] })
  scrollEl.parentElement = body
  const clip = conversationClip(doc, win, () => [], (el) => (
    el === scrollEl ? { overflowY: 'auto' } : { overflowY: 'visible' }
  ))
  assert.deepEqual(clip, { top: 100, bottom: 800 })
})

test('裁剪框夹在视口内（滚动容器部分移出视口时）', () => {
  const scroller = { getBoundingClientRect: () => ({ top: -40, bottom: 2000, height: 2040 }) }
  const { doc } = makeHost({ scroller, flow: {} })
  assert.deepEqual(conversationClip(doc, win, () => [], () => ({ overflowY: 'auto' })), {
    top: 0,
    bottom: 922,
  })
})

function bodyOf(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `client.js should define ${name}()`)
  const end = source.indexOf('\n      }', start)
  return source.slice(start, end)
}

test('角标锚点按会话视图判定可见性，不再用窗口坐标', () => {
  for (const name of ['buildMarkers', 'updateMarkerPositions']) {
    const body = bodyOf(name)
    assert.match(body, /var clipTop = ui\.clipTop != null \? ui\.clipTop : 0/, `${name} 应读取裁剪框`)
    assert.match(body, /r\.bottom > clipTop && r\.top < clipBottom/, `${name} 应按裁剪框挑锚点`)
    assert.doesNotMatch(body, /r\.top > -8 && r\.top < window\.innerHeight/, `${name} 不该再按窗口判定`)
  }
})

test('角标不再被夹到窗口顶部，滚出会话视图即隐藏', () => {
  for (const name of ['buildMarkers', 'updateMarkerPositions']) {
    const body = bodyOf(name)
    assert.doesNotMatch(body, /chipTop < 4/, `${name} 不该再把角标钉在窗口顶部`)
    assert.match(body, /chipTop \+ 22 <= clipTop \|\| chipTop >= clipBottom/, `${name} 应隐藏已滑出的角标`)
  }
})

test('编号角标层按会话视图裁剪，高亮层用 evenodd 挖掉顶部区域', () => {
  const body = bodyOf('renderMarkers')
  assert.match(body, /ui\.clipTop = clip\.top/)
  assert.match(body, /ui\.clipBottom = clip\.bottom/)
  assert.match(body, /markerLayer\.style\.clipPath = clip\.top > 0 \|\| clip\.bottom < window\.innerHeight/)
  assert.match(body, /'inset\(' \+ clip\.top \+ 'px 0px '/)
  assert.match(body, /'polygon\(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0' \+ hole \+ topBand \+ '\)'/)
})
