// v1.7.2 · 技能/文件引用芯片不能被当成斜杠命令，也不能在拼块时被压平
//
// 事实依据（宿主 0.2.2-alpha.3）：
//   * 技能芯片的剪贴板投影就是 `/skill-name`（dsh-client-ui-skill 用 `/name` 反查路径）；
//   * 宿主 parseCommand 只认**文本开头**的 token，查不到注册项就按普通消息发出
//     （dsh-commands `execute()` 返回 undefined → 回落普通提交）；
//   * 所以「开头是 /」不等于「是命令」，要看那个 token 是不是落在引用芯片区间里。
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

function extract(name, deps = {}) {
  const keys = Object.keys(deps)
  return Function(...keys, `return (${raw(name)})`)(...keys.map((key) => deps[key]))
}

const leadingTokenIsChip = extract('leadingTokenIsChip', {})
const commandNameOf = extract('commandNameOf', {})
/** v1.7.6：命令判定要问宿主命令目录，测试里用假的 directory 注入。 */
const makeIsCommandDraft = (dir) => extract('isCommandDraft', {
  commandNameOf,
  leadingTokenIsChip,
  inputSnapshotOf: (shell) => (shell !== null && shell !== undefined && shell.state !== undefined ? shell.state.getSnapshot() : null),
  ctx: { get: () => (dir === undefined || dir === null ? null : { directory: dir }) },
  currentSessionId: () => 's1',
})
const isCommandDraft = makeIsCommandDraft()

const chip = (offset, length, ref = '/darwin-skill') => ({
  occurrenceId: 1, source: 'skill', ref, offset, length,
  label: 'darwin-skill', clipboardText: ref,
})

test('真正打出来的斜杠命令仍然按命令处理', () => {
  assert.equal(isCommandDraft('/model'), true)
  assert.equal(isCommandDraft('   /goal 做点事'), true, 'leading spaces still count')
  assert.equal(isCommandDraft('/model 换成 v4'), true, 'arguments after the token')
})

test('普通正文里出现 / 不算命令', () => {
  assert.equal(isCommandDraft('正文 /model'), false)
  assert.equal(isCommandDraft(''), false)
})

test('技能引用芯片（/skill-name）不是命令 —— 否则「技能 + 正文 + 批注」永远发不出去', () => {
  assert.equal(leadingTokenIsChip('/darwin-skill 帮我看看', [chip(0, 13)]), true)
  assert.equal(leadingTokenIsChip('/darwin-skill', [chip(0, 13)]), true)
})

test('芯片在正文中间时本来就不算命令（回归）', () => {
  assert.equal(leadingTokenIsChip('帮我看下 /darwin-skill 这个', [chip(5, 13)]), false)
})

test('开头是命令 token、芯片在别处 → 仍然是命令', () => {
  assert.equal(leadingTokenIsChip('/goal 看看 /darwin-skill', [chip(11, 13)]), false)
  assert.equal(isCommandDraft('/goal 看看 /darwin-skill'), true)
})

test('没有芯片 / 芯片数据缺失时退化为旧行为', () => {
  assert.equal(leadingTokenIsChip('/model', null), false)
  assert.equal(leadingTokenIsChip('/model', []), false)
  assert.equal(leadingTokenIsChip('/model', [null, undefined]), false)
})

test('shiftReferences 把芯片偏移整体平移，并丢掉 occurrenceId', () => {
  const shiftReferences = extract('shiftReferences', {})
  const out = shiftReferences([chip(0, 13), chip(20, 5, '/README.md')], 100)
  assert.equal(out.length, 2)
  assert.equal(out[0].offset, 100)
  assert.equal(out[0].length, 13)
  assert.equal(out[0].source, 'skill')
  assert.equal(out[0].ref, '/darwin-skill')
  assert.equal(out[0].clipboardText, '/darwin-skill')
  assert.equal(out[1].offset, 120)
  assert.equal('occurrenceId' in out[0], false, 'occurrenceId is shell-owned, never pass it back')
})

test('有芯片时拼稿载荷是结构化草稿（保住技能引用），无芯片时是纯文本', () => {
  const draftPayloadFor = extract('draftPayloadFor', {
    inputSnapshotOf: (shell) => shell.state.getSnapshot(),
    resolveDraftText: () => '',
    shiftReferences: (occ, pad) => occ.map((o) => ({ ...o, offset: o.offset + pad })),
  })
  const withChip = draftPayloadFor(
    { state: { getSnapshot: () => ({ draft: '/darwin-skill 帮我看看', occurrences: [chip(0, 13)] }) } },
    'BLOCK', true)
  assert.equal(typeof withChip, 'object')
  assert.equal(withChip.text, 'BLOCK\n/darwin-skill 帮我看看')
  assert.equal(withChip.references[0].offset, 6, 'chip offset shifts by block length + newline')
  assert.deepEqual(withChip.quotes, [])

  const plain = draftPayloadFor(
    { state: { getSnapshot: () => ({ draft: '普通正文', occurrences: [] }) } },
    'BLOCK', true)
  assert.equal(typeof plain, 'string')
  assert.equal(plain, 'BLOCK\n普通正文')
})

// ---------- v1.7.6：命令目录判定 ----------

test('命令目录就绪时：真命令拦住，技能 token 放行（本轮修复的核心）', () => {
  const hit = makeIsCommandDraft({
    resolve: (sid, name) => (name === 'plan' ? { name } : undefined),
    status: () => 'ready',
  })
  assert.equal(hit('/plan 做点事'), true)
  assert.equal(hit('/goutoujunshi 女生问我出来玩吗'), false, 'skill token is not a command')

  const cold = makeIsCommandDraft({ resolve: () => undefined, status: () => 'cold' })
  assert.equal(cold('/goutoujunshi'), true, 'cold catalog stays conservative')
})

test('已 claim 的相位优先：从菜单选中的命令即便目录查不到也拦住', () => {
  const claimed = extract('isCommandDraft', {
    commandNameOf,
    leadingTokenIsChip: () => false,
    inputSnapshotOf: () => ({ phase: 'claimed', occurrences: [] }),
    ctx: { get: () => ({ directory: { resolve: () => undefined, status: () => 'ready' } }) },
    currentSessionId: () => 's1',
  })
  assert.equal(claimed('/whatever args'), true)
})

test('引用芯片优先于目录：芯片形态的 /skill 永远不是命令', () => {
  const chipFirst = extract('isCommandDraft', {
    commandNameOf,
    leadingTokenIsChip: () => true,
    inputSnapshotOf: () => ({ phase: 'claimed', occurrences: [] }),
    ctx: { get: () => ({ directory: { resolve: () => ({ name: 'plan' }), status: () => 'ready' } }) },
    currentSessionId: () => 's1',
  })
  assert.equal(chipFirst('/darwin-skill 帮我看看'), false)
})
// ---------- v1.8.9：输入触发器菜单开着时绝不拼块 ----------

test('触发器菜单开着 → 不拼块；关着 → 正常放行（/mo 回车选 /model 的根因）', () => {
  const open = extract('triggerMenuOpen', {})
  assert.equal(open({ querySelector: () => ({}) }), true, 'menu present → true')
  assert.equal(open({ querySelector: () => null }), false, 'menu absent → false')
  assert.equal(open(), false, 'no document → 安全返回 false，不阻断正常发送')
})
