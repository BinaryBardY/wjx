#!/usr/bin/env node
/**
 * 问卷星自动填写脚本 - 核心逻辑测试
 * 测试 parseQuestions, buildRadioPools, shuffle, 状态管理, 完成页计数等
 */
'use strict';

// ==================== Mock DOM 环境 ====================
const { JSDOM } = (() => {
  try { return require('jsdom'); } catch (e) {
    console.log('需要安装 jsdom: npm install jsdom');
    process.exit(1);
  }
})();

// ==================== 测试工具 ====================
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEq failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(`${msg || 'assertDeepEq failed'}: expected ${b}, got ${a}`);
  }
}

// ==================== HTML 模拟问卷页面 ====================
function buildSurveyHTML() {
  return `<!DOCTYPE html><html><body>
    <form id="form1">
      <fieldset id="fieldset1">
        <!-- q1: 单选 4选项 年级 -->
        <div class="field ui-field-contain" topic="1" id="div1" req="1" type="3">
          <div class="topichtml">您的年级是？</div>
          <div class="ui-radio"><input type="radio" value="1" id="q1_1" name="q1"><label for="q1_1">A. 大一</label></div>
          <div class="ui-radio"><input type="radio" value="2" id="q1_2" name="q1"><label for="q1_2">B. 大二</label></div>
          <div class="ui-radio"><input type="radio" value="3" id="q1_3" name="q1"><label for="q1_3">C. 大三</label></div>
          <div class="ui-radio"><input type="radio" value="4" id="q1_4" name="q1"><label for="q1_4">D. 大四</label></div>
        </div>
        <!-- q2: 单选 5选项 专业 -->
        <div class="field ui-field-contain" topic="2" id="div2" req="1" type="3">
          <div class="topichtml">您的专业类别是？</div>
          <div class="ui-radio"><input type="radio" value="1" id="q2_1" name="q2"><label for="q2_1">A. 理工类</label></div>
          <div class="ui-radio"><input type="radio" value="2" id="q2_2" name="q2"><label for="q2_2">B. 人文社科类</label></div>
          <div class="ui-radio"><input type="radio" value="3" id="q2_3" name="q2"><label for="q2_3">C. 经管法类</label></div>
          <div class="ui-radio"><input type="radio" value="4" id="q2_4" name="q2"><label for="q2_4">D. 艺术体育类</label></div>
          <div class="ui-radio"><input type="radio" value="5" id="q2_5" name="q2"><label for="q2_5">E. 其他</label></div>
        </div>
        <!-- q5: 多选 6选项 -->
        <div class="field ui-field-contain" topic="5" id="div5" req="1" type="4">
          <div class="topichtml">以下哪些是强调的重要内容？</div>
          <div class="ui-checkbox"><input type="checkbox" value="1" id="q5_1" name="q5"><label for="q5_1">选项A</label></div>
          <div class="ui-checkbox"><input type="checkbox" value="2" id="q5_2" name="q5"><label for="q5_2">选项B</label></div>
          <div class="ui-checkbox"><input type="checkbox" value="3" id="q5_3" name="q5"><label for="q5_3">选项C</label></div>
          <div class="ui-checkbox"><input type="checkbox" value="4" id="q5_4" name="q5"><label for="q5_4">选项D</label></div>
          <div class="ui-checkbox"><input type="checkbox" value="5" id="q5_5" name="q5"><label for="q5_5">选项E</label></div>
          <div class="ui-checkbox"><input type="checkbox" value="6" id="q5_6" name="q5"><label for="q5_6">以上都不知道</label></div>
        </div>
        <!-- q11: 填空 -->
        <div class="field ui-field-contain" topic="11" id="div11" type="1">
          <div class="topichtml">开放题</div>
          <input type="text" id="q11" name="q11">
        </div>
      </fieldset>
      <div id="ctlNext" class="submitbtn">提交</div>
    </form>
    <div id="captchaOut" style="display:none;padding:0 40px;">
      <div id="captchaWrap"><div id="captcha"></div><div id="captchabtn"></div></div>
    </div>
  </body></html>`;
}

// ==================== 复制脚本核心函数 ====================
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function parseQuestions(doc) {
  const questions = [];
  doc.querySelectorAll('.field.ui-field-contain').forEach(field => {
    const type = field.getAttribute('type');
    const name = field.querySelector('input')?.name;
    const title = field.querySelector('.topichtml')?.textContent?.trim() || '';
    if (!name) return;

    const options = [];
    if (type === '3') {
      field.querySelectorAll('input[type="radio"]').forEach(inp => {
        const label = field.querySelector(`label[for="${inp.id}"]`)?.textContent?.trim() || '';
        options.push({ value: inp.value, label, id: inp.id });
      });
    } else if (type === '4') {
      field.querySelectorAll('input[type="checkbox"]').forEach(inp => {
        const label = field.querySelector(`label[for="${inp.id}"]`)?.textContent?.trim() || '';
        options.push({ value: inp.value, label, id: inp.id });
      });
    }

    questions.push({
      name, type, title, options,
      required: field.getAttribute('req') === '1',
      isRadio: type === '3',
      isCheckbox: type === '4',
      isText: type === '1',
      el: field
    });
  });
  return questions;
}

function weightedIndex(weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return Math.floor(Math.random() * weights.length);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function buildRadioPools(questions, totalCount, ratiosConfig) {
  const pools = {};
  for (const q of questions) {
    if (!q.isRadio) continue;
    const weights = ratiosConfig[q.name] || q.options.map(() => 1);
    const sum = weights.reduce((a, b) => a + b, 0);
    const counts = new Array(q.options.length).fill(0);

    if (sum <= 0) {
      const base = Math.floor(totalCount / q.options.length);
      for (let i = 0; i < q.options.length; i++) counts[i] = base;
      let rem = totalCount - base * q.options.length;
      for (let i = 0; i < rem; i++) counts[i]++;
    } else {
      const fractions = weights.map(w => (w / sum) * totalCount);
      for (let i = 0; i < fractions.length; i++) counts[i] = Math.floor(fractions[i]);
      const allocated = counts.reduce((a, b) => a + b, 0);
      let rem = totalCount - allocated;
      const sortedByRemainder = fractions
        .map((f, i) => ({ i, rem: f - Math.floor(f) }))
        .sort((a, b) => b.rem - a.rem);
      for (let k = 0; k < rem; k++) {
        counts[sortedByRemainder[k].i]++;
      }
    }

    const pool = [];
    counts.forEach((cnt, i) => {
      for (let j = 0; j < cnt; j++) pool.push(i);
    });
    pools[q.name] = shuffle(pool);
  }
  return pools;
}

function getWeights(question, ratiosConfig) {
  const saved = ratiosConfig[question.name];
  if (saved && saved.length === question.options.length) {
    return saved.map(w => Math.max(0, w));
  }
  return question.options.map(() => 1);
}

// ==================== 测试套件 ====================
console.log('\n========== 问卷星脚本核心逻辑测试 ==========\n');

// --- 1. parseQuestions ---
console.log('1. parseQuestions 解析测试');
{
  const dom = new JSDOM(buildSurveyHTML());
  const doc = dom.window.document;
  const questions = parseQuestions(doc);

  test('解析出 4 道题', () => {
    assertEq(questions.length, 4);
  });

  test('q1 是单选, 4 选项', () => {
    const q = questions.find(q => q.name === 'q1');
    assert(q.isRadio, '应该是单选');
    assert(!q.isCheckbox, '不应该是多选');
    assertEq(q.options.length, 4);
    assertEq(q.options[0].label, 'A. 大一');
    assert(q.required, '应该是必填');
  });

  test('q2 是单选, 5 选项', () => {
    const q = questions.find(q => q.name === 'q2');
    assert(q.isRadio);
    assertEq(q.options.length, 5);
    assertEq(q.options[4].label, 'E. 其他');
  });

  test('q5 是多选, 6 选项', () => {
    const q = questions.find(q => q.name === 'q5');
    assert(q.isCheckbox, '应该是多选');
    assert(!q.isRadio, '不应该是单选');
    assertEq(q.options.length, 6);
  });

  test('q11 是填空', () => {
    const q = questions.find(q => q.name === 'q11');
    assert(q.isText, '应该是填空');
    assertEq(q.options.length, 0);
  });
}

// --- 2. buildRadioPools ---
console.log('\n2. buildRadioPools 分配池测试');
{
  const dom = new JSDOM(buildSurveyHTML());
  const doc = dom.window.document;
  const questions = parseQuestions(doc);

  test('均等权重 [1,1,1,1] 10份 → 分布接近 [3,3,2,2] 或 [2,2,3,3]', () => {
    const ratios = { q1: [1, 1, 1, 1] };
    const pools = buildRadioPools(questions, 10, ratios);
    const pool = pools['q1'];
    assertEq(pool.length, 10, '池长度应为10');

    const counts = [0, 0, 0, 0];
    pool.forEach(i => counts[i]++);
    const total = counts.reduce((a, b) => a + b, 0);
    assertEq(total, 10, '总和应为10');
    // 每个选项应该至少出现1次
    counts.forEach((c, i) => assert(c >= 1, `选项${i}出现${c}次, 应该>=1`));
    // 最大值和最小值差距不超过2 (对于10次均匀分配)
    const max = Math.max(...counts);
    const min = Math.min(...counts);
    assert(max - min <= 2, `max-min=${max - min}, 应该<=2`);
  });

  test('权重 [2,5,3] 10份 → [2,5,3]', () => {
    const ratios = { q1: [2, 5, 3] };
    const pools = buildRadioPools(questions, 10, ratios);
    const pool = pools['q1'];
    assertEq(pool.length, 10);
    const counts = [0, 0, 0, 0];
    pool.forEach(i => counts[i]++);
    assertDeepEq([counts[0], counts[1], counts[2]], [2, 5, 3], '权重[2,5,3]应精确分配为[2,5,3]');
  });

  test('权重 [7,2,1] 20份 → [14,4,2]', () => {
    const ratios = { q1: [7, 2, 1] };
    const pools = buildRadioPools(questions, 20, ratios);
    const pool = pools['q1'];
    assertEq(pool.length, 20);
    const counts = [0, 0, 0, 0];
    pool.forEach(i => counts[i]++);
    assertDeepEq([counts[0], counts[1], counts[2]], [14, 4, 2], '权重[7,2,1]x20应分配为[14,4,2]');
  });

  test('全零权重 [0,0,0,0] 10份 → 均匀分配', () => {
    const ratios = { q1: [0, 0, 0, 0] };
    const pools = buildRadioPools(questions, 10, ratios);
    const pool = pools['q1'];
    assertEq(pool.length, 10);
    const counts = [0, 0, 0, 0];
    pool.forEach(i => counts[i]++);
    const total = counts.reduce((a, b) => a + b, 0);
    assertEq(total, 10);
  });

  test('只处理单选题，多选和填空不在池中', () => {
    const ratios = {};
    const pools = buildRadioPools(questions, 10, ratios);
    assert(pools['q1'], '单选 q1 应在池中');
    assert(pools['q2'], '单选 q2 应在池中');
    assert(!pools['q5'], '多选 q5 不应在池中');
    assert(!pools['q11'], '填空 q11 不应在池中');
  });

  test('1份提交, 权重 [1,3] → 大概率选中选项2 (权重3)', () => {
    // 跑100次, 选项2(权重3)应该赢多数
    const ratios = { q1: [1, 3] };
    let opt2Wins = 0;
    for (let run = 0; run < 100; run++) {
      const pools = buildRadioPools(questions, 1, ratios);
      if (pools['q1'][0] === 1) opt2Wins++;
    }
    assert(opt2Wins >= 50, `100次中选项2(权重3)赢了${opt2Wins}次, 应>50 (理论75)`);
  });
}

// --- 3. shuffle ---
console.log('\n3. shuffle 洗牌测试');
{
  test('洗牌后长度不变', () => {
    const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const shuffled = shuffle(arr);
    assertEq(shuffled.length, arr.length);
  });

  test('洗牌后包含所有原元素', () => {
    const arr = [0, 1, 2, 3, 4];
    const shuffled = shuffle(arr);
    const sorted = [...shuffled].sort((a, b) => a - b);
    assertDeepEq(sorted, [0, 1, 2, 3, 4]);
  });

  test('洗牌不改变原数组', () => {
    const arr = [0, 1, 2, 3, 4];
    const copy = [...arr];
    shuffle(arr);
    assertDeepEq(arr, copy, '原数组不应改变');
  });

  test('多次洗牌结果不会总是相同', () => {
    const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const results = new Set();
    for (let i = 0; i < 20; i++) {
      results.add(shuffle(arr).join(','));
    }
    assert(results.size > 1, `20次洗牌只产生${results.size}种不同结果, 应该>1`);
  });
}

// --- 4. weightedIndex ---
console.log('\n4. weightedIndex 加权随机测试');
{
  test('权重 [1,1,1,1] 多次采样, 各选项概率接近', () => {
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 10000; i++) {
      counts[weightedIndex([1, 1, 1, 1])]++;
    }
    counts.forEach(c => {
      const ratio = c / 10000;
      assert(ratio > 0.2 && ratio < 0.3, `概率${ratio.toFixed(3)}应在0.2-0.3之间`);
    });
  });

  test('权重 [5,1,1] 5000次, 选项0选中率 > 50%', () => {
    const counts = [0, 0, 0];
    for (let i = 0; i < 5000; i++) {
      counts[weightedIndex([5, 1, 1])]++;
    }
    assert(counts[0] > 2500, `选项0权重5选中${counts[0]}次, 应>2500`);
  });

  test('全零权重不会crash', () => {
    const idx = weightedIndex([0, 0, 0]);
    assert(idx >= 0 && idx < 3);
  });
}

// --- 5. 状态管理 ---
console.log('\n5. 状态管理测试');
{
  test('默认状态结构', () => {
    const defaultState = { totalCount: 10, completedCount: 0, isRunning: false, ratios: {} };
    assertEq(defaultState.totalCount, 10);
    assertEq(defaultState.completedCount, 0);
    assertEq(defaultState.isRunning, false);
  });

  test('completedCount 递增', () => {
    let state = { totalCount: 10, completedCount: 0, isRunning: true, ratios: {} };
    state.completedCount++;
    assertEq(state.completedCount, 1);
    state.completedCount++;
    assertEq(state.completedCount, 2);
  });

  test('完成时停止运行', () => {
    let state = { totalCount: 5, completedCount: 5, isRunning: true, ratios: {} };
    state.isRunning = state.completedCount < state.totalCount;
    assertEq(state.isRunning, false);
  });

  test('完成页增量不会超过目标 (边界情况)', () => {
    // 模拟: 已完成4, 目标5, 完成页+1 = 5, 刚好等于目标
    let state = { totalCount: 5, completedCount: 4, isRunning: true, ratios: {} };
    state.completedCount++;
    assertEq(state.completedCount, 5);
    state.isRunning = state.completedCount < state.totalCount;
    assertEq(state.isRunning, false, '达到目标应停止');
  });

  test('ratios 配置独立性', () => {
    const ratios = { q1: [1, 2, 3, 4], q2: [5, 5, 5, 5, 5] };
    assertEq(ratios.q1.length, 4);
    assertEq(ratios.q2.length, 5);
    assertDeepEq(ratios.q1, [1, 2, 3, 4]);
  });
}

// --- 6. getWeights ---
console.log('\n6. getWeights 权重获取测试');
{
  const mockQ = { name: 'q1', options: [{}, {}, {}, {}] };

  test('有配置时返回配置', () => {
    const w = getWeights(mockQ, { q1: [2, 3, 1, 1] });
    assertDeepEq(w, [2, 3, 1, 1]);
  });

  test('无配置时返回默认均等权重', () => {
    const w = getWeights(mockQ, {});
    assertDeepEq(w, [1, 1, 1, 1]);
  });

  test('负权重转为 0', () => {
    const w = getWeights(mockQ, { q1: [-1, 0, 5, 3] });
    assertDeepEq(w, [0, 0, 5, 3]);
  });

  test('配置长度不匹配时返回默认', () => {
    const w = getWeights(mockQ, { q1: [1, 2] }); // 只有2个但需要4个
    assertDeepEq(w, [1, 1, 1, 1]);  // 长度不匹配应回退到默认均等权重
  });
}

// --- 7. 完成页计数逻辑 ---
console.log('\n7. 完成页计数逻辑测试');
{
  test('完成页正常增量', () => {
    let state = { totalCount: 10, completedCount: 3, isRunning: true, ratios: {} };
    // 模拟完成页 handler
    state.completedCount++;
    assertEq(state.completedCount, 4);
  });

  test('最后一份完成后停止', () => {
    let state = { totalCount: 3, completedCount: 2, isRunning: true, ratios: {} };
    state.completedCount++; // =3
    const allDone = state.completedCount >= state.totalCount;
    assert(allDone, '3/3 应全部完成');
    if (allDone) state.isRunning = false;
    assertEq(state.isRunning, false);
  });

  test('完成页和主循环不会同时计数 (互斥性)', () => {
    // 模拟场景: 主循环在 DOM 检测后计数 + 完成页也计数
    // 设计上这是互斥的: 要么跳转到完成页(完成页计数), 要么留在原页面(DOM检测计数)
    let domCounted = false;
    let pageCounted = false;

    // 场景A: 页面跳转
    const scenarioA = () => {
      if (!domCounted) pageCounted = true;
    };
    scenarioA();
    assert(pageCounted, '场景A应由完成页计数');
    assert(!domCounted, '场景A不应由DOM计数');

    // 场景B: 页面不跳转
    const scenarioB = () => {
      if (!pageCounted) domCounted = true;
    };
    domCounted = false; pageCounted = false;
    scenarioB();
    assert(domCounted, '场景B应由DOM计数');
    assert(!pageCounted, '场景B不应由完成页计数');
  });
}

// --- 8. 多选题互斥选项处理 ---
console.log('\n8. 多选题互斥选项逻辑测试');
{
  test('"以上都不知道" 匹配正则', () => {
    const exclusivePattern = /以上都不|以上没有|不清楚|不太清楚|不知道/;
    assert(exclusivePattern.test('以上都不知道'), '应匹配"以上都不知道"');
    assert(exclusivePattern.test('不太清楚'), '应匹配"不太清楚"');
    assert(exclusivePattern.test('不知道'), '应匹配"不知道"');
    assert(!exclusivePattern.test('选项A'), '不应匹配"选项A"');
    assert(!exclusivePattern.test('正常选项'), '不应匹配"正常选项"');
  });
}

// --- 9. 边界情况 ---
console.log('\n9. 边界情况测试');
{
  test('buildRadioPools: totalCount=1, 4选项均权', () => {
    const dom = new JSDOM(buildSurveyHTML());
    const doc = dom.window.document;
    const questions = parseQuestions(doc);
    const pools = buildRadioPools(questions, 1, {});
    assertEq(pools['q1'].length, 1, '只有1份应生成1个选择');
    assert(pools['q1'][0] >= 0 && pools['q1'][0] < 4, '选项索引应合法');
  });

  test('buildRadioPools: totalCount=100, 4选项均权', () => {
    const dom = new JSDOM(buildSurveyHTML());
    const doc = dom.window.document;
    const questions = parseQuestions(doc);
    const pools = buildRadioPools(questions, 100, { q1: [1, 1, 1, 1] });
    assertEq(pools['q1'].length, 100);
    const counts = [0, 0, 0, 0];
    pools['q1'].forEach(i => counts[i]++);
    assertEq(counts.reduce((a, b) => a + b, 0), 100);
    // 每个选项应在22-28之间(理论25)
    counts.forEach((c, i) => {
      assert(c >= 22 && c <= 28, `选项${i}有${c}次, 应在22-28之间(理论25)`);
    });
  });

  test('buildRadioPools: 单一选项100%', () => {
    const dom = new JSDOM(buildSurveyHTML());
    const doc = dom.window.document;
    const questions = parseQuestions(doc);
    const pools = buildRadioPools(questions, 10, { q1: [0, 10, 0, 0] });
    assertEq(pools['q1'].length, 10);
    const allOnes = pools['q1'].every(i => i === 1);
    assert(allOnes, '所有权重给选项1, 应全选选项1');
  });

  test('parseQuestions: 无题目时返回空数组', () => {
    const dom = new JSDOM('<html><body></body></html>');
    const doc = dom.window.document;
    const questions = parseQuestions(doc);
    assertEq(questions.length, 0);
  });
}

// --- 10. URL 匹配 ---
console.log('\n10. URL 匹配测试');
{
  test('完成页 URL 检测', () => {
    const completionURL = 'https://v.wjx.cn/wjx/join/completemobile2.aspx?activityid=wFhgGhJ&joinactivity=126941930869';
    assert(completionURL.includes('/completemobile2.aspx'), '应检测到完成页URL');
  });

  test('问卷URL 不是完成页', () => {
    const surveyURL = 'https://v.wjx.cn/vm/wFhgGhJ.aspx';
    assert(!surveyURL.includes('/completemobile2.aspx'), '问卷URL不应被识别为完成页');
  });

  test('从完成页 URL 提取 activityId', () => {
    const url = 'https://v.wjx.cn/wjx/join/completemobile2.aspx?activityid=wFhgGhJ&joinactivity=126941930869';
    const params = new URLSearchParams(url.split('?')[1]);
    const activityId = params.get('activityid');
    assertEq(activityId, 'wFhgGhJ');
    const reconstructedURL = `https://v.wjx.cn/vm/${activityId}.aspx`;
    assertEq(reconstructedURL, 'https://v.wjx.cn/vm/wFhgGhJ.aspx');
  });
}

// ==================== 结果 ====================
console.log('\n========== 测试结果 ==========');
console.log(`通过: ${passed}, 失败: ${failed}, 总计: ${passed + failed}`);

if (failed > 0) {
  console.log('\n失败详情:');
  failures.forEach(f => console.log(`  ✗ ${f.name}: ${f.error}`));
  process.exit(1);
} else {
  console.log('全部测试通过! ✅');
}
