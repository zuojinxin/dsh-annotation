import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const protocol = source.slice(source.indexOf('    var STR = {'), source.indexOf('    // ============================== 工具'))
function fn(name) {
  const match = source.match(new RegExp(`      function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n      \\}`))
  assert.ok(match, name)
  return match[0]
}
function harness(lang, draft, sourcePath) {
  const nodes = []
  const bubble = { querySelectorAll: () => [], get textContent() { return nodes.map(n => n.nodeValue).join('') } }
  const row = { querySelector: () => bubble }
  const shell = { state: { getSnapshot: () => ({ draft }) }, setDraft(value) { draft = value } }
  const document = { createTreeWalker: () => { let i = 0; return { nextNode: () => nodes[i++] ?? null } } }
  const api = Function('shell', 'document', 'NodeFilter', 'sourcePath', `
    ${protocol}
    ${source.slice(source.indexOf('    function quoteWithSource('), source.indexOf('    function assistantRows('))}
    var ui = { quotes: [{ text: '原文包含提问：这个词', note: '解释一下' }] }
    ui.quotes[0].sourcePath = sourcePath
    var annotationAttached = false
    var sessions = { list: { getSnapshot: () => ({ current: 'session' }) }, scope: () => ({}) }
    var ctx = { conversation: { input: { for: () => shell } } }
    function showToast() {}
    // 本地版本把「会话 id / 作用域 / 输入 shell」的解析抽成了三个 helper
    // （服务 inactive 时各自回退，见 client.js 的 currentSessionId / scopeOfSession /
    // shellFor），这里按同样的语义给 attachAndSend 提供桩。
    function currentSessionId() { return 'session' }
    function scopeOfSession() { return {} }
    function shellFor() { return shell }
    // v1.4.23：attachAndSend 成功后要打开「期待新气泡」窗口（见 client.js 的
    // markFreshBubble）。它是 attachAndSend 的自由变量，harness 必须给桩，否则会抛
    // ReferenceError 被 try/catch 吞掉 → attachAndSend 变成返回 false。
    function markFreshBubble() {}
    // v1.6.3：拼稿后把输入框文字设为透明（仅非 Electron 宿主生效，修「发送瞬间
    // 看到批注原文」）。它是 attachAndSend 的自由变量，harness 必须给桩。
    function maskComposerForWeb() {}
    // v1.4.26：attachAndSend 的正文改为经 resolveDraftText 从「服务态 + 输入区」两处取
    // （只读服务态会在输入区文字还没同步进去时把正文读丢，生成 headOnly 变体——正是
    // 「批注与正文分成两轮」的根因，见 client.js 的 resolveDraftText）。harness 按同样
    // 语义给桩。rollbackDraft 也是新增的自由变量（提交被拒时还原草稿用）。
    var rollbackDraft = null
    function domDraftText() { return '' }
    function resolveDraftText(sh) {
      var text = ''
      try { text = sh.state.getSnapshot().draft || '' } catch (_) { text = '' }
      if (text.trim() !== '') return text
      var dom = domDraftText()
      return dom.trim() !== '' ? dom : text
    }
    ${['buildBlock', 'shouldAttachForEnter', 'isCommandDraft', 'attachAndSend', 'cutRange', 'pruneEmpty', 'hideAnnotationBlock', 'parseItemsFromBubble'].map(fn).join('\n')}
    return { setLang, attachAndSend, hideAnnotationBlock, parseItemsFromBubble }
  `)(shell, document, { SHOW_TEXT: 4 }, sourcePath)
  api.setLang(lang)
  return { api, row, bubble, shell, render(value) {
    nodes.length = 0
    // The host may split message text across nodes.
    for (const text of [value.slice(0, 10), value.slice(10)]) nodes.push({ nodeValue: text, parentNode: { removeChild(node) { node.nodeValue = '' } } })
  } }
}

for (const lang of ['zh', 'en']) {
  test(`${lang}: 空白草稿只发送批注，刷新后仍能解析和隐藏`, () => {
    for (const draft of ['', ' \n\t ']) {
      const h = harness(lang, draft)
      assert.equal(h.api.attachAndSend({}), true)
      const sent = h.shell.state.getSnapshot().draft
      assert.doesNotMatch(sent, /(?:提问：|Ask:)\s*$/)
      // 纯批注（headOnly）不该带「回答顺序」指令——没有提问就没有顺序可言。
      assert.doesNotMatch(sent, /回答顺序|Answer order/)
      assert.match(sent, /Annotation/)
      assert.equal(h.api.attachAndSend({}), true)
      assert.equal(h.shell.state.getSnapshot().draft, sent, '重复发送前不重复拼稿')
      h.render(sent)
      h.api.setLang(lang === 'zh' ? 'en' : 'zh')
      assert.deepEqual(h.api.parseItemsFromBubble(h.row), [{ text: '原文包含提问：这个词', note: '解释一下' }])
      assert.equal(h.api.hideAnnotationBlock(h.row), true)
      assert.equal(h.bubble.textContent, '')
    }
  })
  test(`${lang}: 有正文保留分隔标记和原始草稿，未完整渲染不误删`, () => {
    const h = harness(lang, '我的问题\n第二行')
    h.api.attachAndSend({})
    const sent = h.shell.state.getSnapshot().draft
    assert.ok(sent.endsWith((lang === 'zh' ? '提问：' : 'Ask:') + '\n我的问题\n第二行'))
    h.render(sent)
    assert.equal(h.api.hideAnnotationBlock(h.row), true)
    assert.equal(h.bubble.textContent, '我的问题\n第二行')
    h.render(lang === 'zh' ? '我批注了以下 1 处内容' : 'I annotated the following 1 passage')
    assert.equal(h.api.hideAnnotationBlock(h.row), false)
    assert.notEqual(h.bubble.textContent, '')
  })
}

for (const lang of ['zh', 'en']) {
  test(`${lang}: 有正文时块序固定为 头部→批注→回答顺序指令→提问标记→用户正文`, () => {
    const h = harness(lang, 'ZZ正文标记ZZ')
    h.api.attachAndSend({})
    const sent = h.shell.state.getSnapshot().draft
    const head = lang === 'zh' ? '我批注了以下 1 处内容' : 'I annotated the following 1 passage'
    const item = '原文包含提问：这个词'
    const order = lang === 'zh' ? '回答顺序：先' : 'Answer order: first'
    const draft = 'ZZ正文标记ZZ'
    // 标记用 lastIndexOf：原文里也可能出现「提问：」（harness 的 quote 就是故意的），
    // 真正的分隔标记一定在最后。
    const at = [sent.indexOf(head), sent.indexOf(item), sent.indexOf(order),
      sent.lastIndexOf(lang === 'zh' ? '提问：' : 'Ask:'), sent.indexOf(draft)]
    assert.ok(at.every(i => i !== -1), '每一段都必须出现：' + at.join(','))
    // 严格递增 = 批注在前、提示词在后；模型先读到的就是批注。
    for (let i = 1; i < at.length; i++) {
      assert.ok(at[i] > at[i - 1], `段序错乱：${at.join(',')}`)
    }
    // 顺序指令必须显式声明「批注在先、回答我的问题在后」，否则模型可能先答提问。
    assert.match(sent, lang === 'zh'
      ? /先.{0,40}逐条回应上面每一条批注（这部分放在最前面），然后再回答我的问题/
      : /first respond to each annotation above.{0,60}that part goes first.{0,30}then answer my question/)
  })
}

for (const lang of ['zh', 'en']) {
  test(`${lang}: 文件路径随批注发送，刷新后的标签仍含完整路径`, () => {
    const h = harness(lang, '', '文档/结果 #1.md')
    assert.equal(h.api.attachAndSend({}), true)
    const sent = h.shell.state.getSnapshot().draft
    assert.ok(sent.includes('[文档/结果 #1.md]\n   原文包含提问：这个词'))
    h.render(sent)
    assert.equal(h.api.parseItemsFromBubble(h.row)[0].text, '[文档/结果 #1.md]\n原文包含提问：这个词')
    assert.equal(h.api.hideAnnotationBlock(h.row), true)
  })
}
