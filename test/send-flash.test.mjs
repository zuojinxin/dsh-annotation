// 发送瞬间不把批注原文画在输入框里
//
// 真因（Web 端 0.2.2-alpha.2 实测，MutationObserver 抓到）：
//   路径 A（有正文/点击发送）只 setDraft 拼稿、放行宿主提交。宿主的 setDraft 是
//   同步写编辑器，于是草稿立刻渲染；Web 宿主的提交跨了任务边界，中间态被绘制出来
//   （composer 记录 t=260408 出现完整「批注块 + 正文」）。桌面端 Electron 宿主
//   同帧完成，不闪。
//
// 不能改走「自己 submit('queue')」——v1.4.26 的注释记录过那会把批注单独发成一条
// （用户报的「分成两轮」）。所以在非 Electron 宿主上只把输入文字设为透明：布局
// 不动、提交路径不动。
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

test('遮罩只在非 Electron 宿主生效（桌面端本来不闪，别动它）', () => {
  const fn = body('maskComposerForWeb')
  assert.match(fn, /if \(isElectronHost\(\)\) return/, 'Electron 直接返回')
  assert.match(fn, /el\.style\.color = 'transparent'/, '只改文字颜色，布局不动')
  assert.match(fn, /setTimeout\(unmaskComposerForWeb, 600\)/, '要有兜底恢复')
})

test('isElectronHost 按 UA 判断', () => {
  assert.match(body('isElectronHost'), /\/Electron\/i/)
})

test('两条拼稿路径 setDraft 之后都调用遮罩', () => {
  for (const name of ['attachAndSend', 'prependBlockForHostSubmit']) {
    const fn = body(name)
    const set = fn.indexOf('shell.setDraft(')
    const mask = fn.indexOf('maskComposerForWeb()')
    assert.ok(set !== -1 && mask !== -1, `${name} 要既有 setDraft 又有遮罩`)
    assert.ok(set < mask, `${name} 必须先拼稿再遮罩`)
  }
})

test('解析不出条目就不隐藏、不贴标签（避免「批注 ×0」和正文被切）', () => {
  for (const name of ['decorateAll', 'hideDockEchoBlocks']) {
    assert.match(body(name), /if \(items\.length === 0\) continue/, `${name} 要提前跳过`)
  }
  assert.doesNotMatch(body('hideDockEchoBlocks'), /if \(items\.length > 0\) attachBubbleTag/,
    'hideDockEchoBlocks 不应再「解析失败也隐藏」')
})
