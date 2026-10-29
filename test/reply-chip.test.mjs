// 回复里的「Annotation N：」跨文本节点也要能变成芯片
//
// 真因（客户端 DevTools 实测）：宿主会把「Annotation 1：」拆成
// 「Annotation 1」+「：」两个文本节点，甚至出现孤立的 "Annotation 1"。
// 旧实现用 TreeWalker 逐节点跑正则，跨节点就必然漏掉；同时外层粗筛只查
// textContent 里有没有 "Annotation" 一词，导致正文里正常讨论这个词的回复
// 也被拉进来，匹配失败后刷「未匹配到」警告——那是误报。
//
// 修法：按 textContent 的字符偏移定位，用 Range 跨节点替换；从后往前替换
// 避免偏移失效；只有真的转出芯片、且拿不到条目数据时才提示。
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

test('decorateAnnotationLabels 按 textContent 偏移 + Range 跨节点替换', () => {
  const fn = body('decorateAnnotationLabels')
  assert.match(fn, /var text = row\.textContent/, '要在整行 textContent 上匹配')
  assert.match(fn, /document\.createRange\(\)/, '要用 Range 跨节点')
  assert.match(fn, /range\.deleteContents\(\)/)
  assert.match(fn, /range\.insertNode\(makeReplyChip\(/, '芯片插到 Range 位置')
  assert.doesNotMatch(fn, /walker\.nextNode\(\)/, '不能退回逐节点匹配')
})

test('从后往前替换：前面的匹配偏移不会被前一次替换打乱', () => {
  const fn = body('decorateAnnotationLabels')
  assert.match(fn, /for \(var i = matches\.length - 1; i >= 0; i--\)/, '必须倒序遍历')
})

test('偏移换算走独立辅助函数', () => {
  const fn = body('textOffsetToNode')
  assert.match(fn, /NodeFilter\.SHOW_TEXT/)
  assert.match(fn, /offset <= acc \+ len/, '落在节点内要返回节点内偏移')
})

test('没有匹配时不报「未匹配到」——正文提到 Annotation 是正常情况', () => {
  const fn = body('decorateAnnotationLabels')
  assert.match(fn, /if \(matches\.length === 0\) return 0/, '无匹配静默返回')
  assert.doesNotMatch(fn, /未匹配到/, '不再输出误报警告')
})

test('条目数据没就绪时不生成占位芯片，等下一轮再装饰', () => {
  const fn = body('decorateAssistantAnnotations')
  const fetch = fn.indexOf('findPrevAnnotationItems(el)')
  const bail = fn.indexOf('if (items === null || items.length === 0) continue')
  const decorate = fn.indexOf('decorateAnnotationLabels(el, items)')
  assert.ok(bail !== -1, '数据为空要跳过本轮')
  assert.ok(fetch < bail, '先取数据再判空')
  assert.ok(bail < decorate, '判空必须在装饰之前')
  // 占位芯片会被「已有芯片就跳过」的守卫永久锁死（重启后第一屏就是这么坏的），
  // 所以宁可晚一轮也不先生成。
  assert.doesNotMatch(fn, /未找到批注条目数据/, '不再生成占位芯片，警告一并去掉')
})
