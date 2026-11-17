// v2.0.13 · 引用被 setDraft 拍平后，正文会粘到引用末行 → 必须重新断开成独立段落。
//
// 真因（用户实测 + 宿主源码 + 会话日志三方对齐）：
//   宿主的「引用」不是 markdown 文本，而是 composer 里**原子 QuoteNode**
//   （dsh-client-ui-conversation/src/client/input/editor/QuoteNode.tsx）。它插入时
//   在节点后紧跟一个分隔空格，用户正文接着打在那个空格之后，于是 QuoteNode 的
//   剪贴板投影是「> …末行」和正文**同一行**：
//
//       > …我来帮你判断怎么下手。 测试，无需回复
//
//   宿主自己提交时，serializeDraftPrompt 的 normalizeQuoteBoundaries 知道节点边界，
//   会在 quote 前后补 \n\n，所以「引用 + 正文」单独用时渲染正常。
//   插件用 setDraft(纯文本) 拼批注块会把 QuoteNode 全部拍平——节点边界信息丢失，
//   normalizeQuoteBoundaries 再也不介入，正文就跟着引用末行走。宿主渲染层
//   （dsh-message-quotes 的 messageQuoteRanges）逐行匹配行首 `>`，把整行并进引用，
//   用户看到的就是「正文显示到引用里面」。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

function raw(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start !== -1, `client.js should define ${name}`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1) }
  }
  throw new Error(`unbalanced braces while reading ${name}`)
}

/** 用最小 DOM 桩跑 quoteTails + breakMergedQuoteTail。
 *  每个引用节点后面挂一个文本兄弟节点（模拟 insertQuote 的分隔空格 + 用户正文），
 *  它的 nextSibling 必须是 null 才能让遍历收尾。 */
function makeFixer(tails, heads) {
  const labels = heads === undefined ? tails.map(() => '') : heads
  const quoteNodes = tails.map((tail, i) => {
    const head = labels[i] || ''
    const prev = head === '' ? null : { nodeType: 3, nodeValue: head, previousSibling: null }
    return {
      previousSibling: prev,
      nextSibling: tail === '' ? null : { nodeType: 3, nodeValue: tail, nextSibling: null },
    }
  })
  const composer = {
    querySelectorAll: (sel) => sel === '[data-composer-quote]' ? quoteNodes : [],
  }
  const composerInputEl = () => composer
  const dlog = () => {}
  return Function('composerInputEl', 'dlog',
    `${raw('quoteTails')}\n${raw('quoteHeads')}\n${raw('breakMergedQuoteTail')}\nreturn breakMergedQuoteTail`,
  )(composerInputEl, dlog)
}

// 会话日志 session-77f0862c 里那条消息的真实投影（拍平后）
const QUOTE_LINES = [
  '> 你好！很高兴见到你 👋',
  '> ',
  '> 我是你的 DeepSeek Harness 编码助手，当前工作区是 default-workspace。',
  '> ',
  '> 有什么想做的，直接说就行。如果不确定要做什么，也可以告诉我你手上的具体问题，我来帮你判断怎么下手。',
]
const LAST_LINE = '> 有什么想做的，直接说就行。如果不确定要做什么，也可以告诉我你手上的具体问题，我来帮你判断怎么下手。'
const BODY = ' 测试，无需回复'          // 前导空格来自 insertQuote 的分隔空格
const FLATTENED = QUOTE_LINES.join('\n') + '\n' + LAST_LINE + BODY

test('正文粘在引用末行时被重新断成独立段落（会话日志的真实投影）', () => {
  const fix = makeFixer([BODY])
  const out = fix(FLATTENED)
  assert.ok(out !== null, 'should detect the merge')
  // 引用行尾空白去掉、正文前导空格去掉（与宿主 normalizeQuoteBoundaries 一致）
  assert.equal(out.text, QUOTE_LINES.join('\n') + '\n' + LAST_LINE + '\n\n测试，无需回复')
  // marks.at 是「新文本里插入 \n\n 的位置」，即引用结束时（正文起点）
  assert.equal(out.marks.length, 1)
  assert.equal(out.marks[0].delta, 2)
  assert.equal(out.text.slice(0, out.marks[0].at).endsWith(LAST_LINE), true)
  assert.equal(out.text.slice(out.marks[0].at), '\n\n测试，无需回复')
})

test('断开之后，引用区间不再吞掉正文（用宿主自己的判定规则验证）', () => {
  // 宿主渲染层同一条规则：dsh-message-quotes/src/client/quote-text.ts
  const QUOTE_RE = /^ {0,3}>[^\r\n]*(?:\r?\n {0,3}>[^\r\n]*)*/gmu
  const quoteTextOf = (t) => t.replace(/\r\n?/gu, '\n').replace(/^ {0,3}>[ \t]?/gmu, '')
  const ranges = (t) => [...t.matchAll(QUOTE_RE)]
    .filter((m) => quoteTextOf(m[0]).trim() !== '')
    .map((m) => ({ start: m.index, end: m.index + m[0].length }))

  const before = ranges(FLATTENED)
  const tailBefore = FLATTENED.slice(before.at(-1).end)
  assert.equal(tailBefore.includes('测试，无需回复'), false, '修复前：正文确实被吞进引用')

  const fixed = makeFixer([BODY])(FLATTENED).text
  const after = ranges(fixed)
  const tailAfter = fixed.slice(after.at(-1).end)
  assert.ok(tailAfter.includes('测试，无需回复'), '修复后：正文回到引用之外')
})

test('正文本来就在下一段时不做任何修改（绝不误切）', () => {
  // 前导空格等价于换行分隔：正文已是独立行，不以 `>` 开头 → 不属于引用。
  const already = QUOTE_LINES.join('\n') + '\n\n测试，无需回复'
  assert.equal(makeFixer(['\n\n测试，无需回复'])(already), null)
  const spaced = QUOTE_LINES.join('\n') + '\n 测试，无需回复'
  assert.equal(makeFixer([' 测试，无需回复'])(spaced), null)
})

test('composer 里没有引用节点时不做任何修改', () => {
  assert.equal(makeFixer([])('some plain draft'), null)
})

test('引用后没有正文（纯引用）时不做任何修改', () => {
  assert.equal(makeFixer([''])(QUOTE_LINES.join('\n')), null)
})

test('正文以换行开头（用户自己换了段）时不做任何修改', () => {
  const ok = QUOTE_LINES.join('\n') + '\n' + LAST_LINE + '\n测试'
  assert.equal(makeFixer(['\n测试'])(ok), null)
})

test('docx：服务态草稿与 DOM 不一致（找不到那段正文）时放弃修改', () => {
  // DOM 里报告有粘连，但草稿文本里并不含那段正文 —— 结构变了，宁可不切。
  assert.equal(makeFixer([BODY])('完全不同的一份草稿'), null)
})

test('多个引用各自粘连时逐个断开，且 marks 按新文本计算', () => {
  const q1 = '> A'
  const q2 = '> B'
  const draft = q1 + ' 甲\n' + q2 + ' 乙'
  const out = makeFixer([' 甲', ' 乙'])(draft)
  assert.ok(out !== null)
  assert.equal(out.text, '> A\n\n甲\n> B\n\n乙')
  assert.equal(out.marks.length, 2)
  // 第一处插入点在 '> A' 之后；第二处的 at 已含第一处插入的 2 个字符
  assert.equal(out.text.slice(0, out.marks[0].at), '> A')
  assert.equal(out.text.slice(0, out.marks[1].at), '> A\n\n甲\n> B')
})

// ---------- v2.0.14：引用**之前**挂着命令/芯片时，> 不在行首 → 引用整条失效 ----------
// 用户实测：斜杠命令在最前面就出问题，放在正文中间就正常。
// 机制：宿主 messageQuoteRanges 逐行匹配**行首** `>`；`/cmd > 引用` 这行不以 > 开头，
// 引用判定为 0 条，引用被当成普通文本显示。

test('斜杠命令在引用之前时被断开（> 回到行首）', () => {
  const head = '/pet-boarding-records '
  const draft = head + '> 测试引用与斜杠命\n\n斜杠正文'
  const out = makeFixer([''], [head])(draft)
  assert.ok(out !== null, 'should detect the prefix merge')
  assert.equal(out.text, '/pet-boarding-records\n\n> 测试引用与斜杠命\n\n斜杠正文')
  assert.equal(out.marks.length, 1)
  assert.equal(out.text.slice(0, out.marks[0].at), '/pet-boarding-records')
})

test('命令在前 + 引用后粘连正文，两处同时断开', () => {
  const head = '/pet-boarding-records '
  const draft = head + '> 引用文字 斜杠正文'
  const out = makeFixer([' 斜杠正文'], [head])(draft)
  assert.ok(out !== null)
  assert.equal(out.text, '/pet-boarding-records\n\n> 引用文字\n\n斜杠正文')
})

test('命令已经在独立行时不做修改', () => {
  const draft = '/pet-boarding-records\n> 引用文字\n\n正文'
  assert.equal(makeFixer([''], ['/pet-boarding-records\n'])(draft), null)
})

test('命令在引用之后（用户说的「中间就正常」）不做修改', () => {
  const draft = '> 引用文字\n\n斜杠正文'
  assert.equal(makeFixer(['\n\n斜杠正文'], [''])(draft), null)
})

test('引用前的前缀断开后，宿主正则能识别出引用（端到端判据）', () => {
  const QUOTE_RE = /^ {0,3}>[^\r\n]*(?:\r?\n {0,3}>[^\r\n]*)*/gmu
  const quoteTextOf = (t) => t.replace(/\r\n?/gu, '\n').replace(/^ {0,3}>[ \t]?/gmu, '')
  const count = (t) => [...t.matchAll(QUOTE_RE)].filter((m) => quoteTextOf(m[0]).trim() !== '').length
  const head = '/pet-boarding-records '
  const broken = head + '> 测试引用与斜杠命\n\n斜杠正文'
  assert.equal(count(broken), 0, '修复前：引用判定为 0 条')
  const fixedText = makeFixer([''], [head])(broken).text
  assert.equal(count(fixedText), 1, '修复后：引用被识别')
})

test('draftPayloadFor 在扁平时仍返回结构化载荷并平移引用芯片偏移', () => {
  const fix = makeFixer([BODY])
  const shell = {
    state: {
      getSnapshot: () => ({ draft: FLATTENED, occurrences: [{ offset: 0, length: 3 }] }),
    },
  }
  const shiftReferences = (occ, pad) => occ.map((o) => ({ ...o, offset: o.offset + pad }))
  const shiftOccurrencesAt = (refs, at, delta) => {
    for (const r of refs) if (r.offset >= at) r.offset += delta
    return refs
  }
  const inputSnapshotOf = () => shell.state.getSnapshot()
  const resolveDraftText = () => FLATTENED
  const wlog = () => {}
  const dlog = () => {}

  const draftPayloadFor = Function(
    'inputSnapshotOf', 'resolveDraftText', 'shiftReferences', 'shiftOccurrencesAt', 'wlog', 'dlog', 'composerInputEl',
    `${raw('quoteTails')}
${raw('quoteHeads')}
${raw('breakMergedQuoteTail')}
${raw('draftPayloadFor')}
return draftPayloadFor`,
  )(inputSnapshotOf, resolveDraftText, shiftReferences, shiftOccurrencesAt, wlog, dlog,
    () => ({
      querySelectorAll: (sel) => sel === '[data-composer-quote]'
        ? [{ previousSibling: null, nextSibling: { nodeType: 3, nodeValue: BODY, nextSibling: null } }] : [],
    }))

  const block = 'BLOCK'
  const payload = draftPayloadFor(shell, block, true)
  assert.equal(typeof payload, 'object', 'structured payload keeps references')
  assert.ok(payload.text.startsWith(block + '\n'))
  assert.ok(payload.text.includes('\n\n测试，无需回复'), '正文已断开')
  // 芯片在偏移 0，插入的两个 \n 只影响落在正文里的偏移；该芯片在块前，只加 base。
  const base = block.length + 1
  assert.equal(payload.references.length, 1)
  assert.equal(payload.references[0].length, 3)
  assert.equal(payload.references[0].offset, 0 + base)
})
