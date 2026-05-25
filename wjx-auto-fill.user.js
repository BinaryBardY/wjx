// ==UserScript==
// @name         问卷星自动填写助手
// @namespace    wjx-auto-filler
// @version      2.3.0
// @description  自动填写并提交问卷星(wjx)问卷，支持自定义提交次数和单选选项比例
// @author       student
// @match        https://v.wjx.cn/vm/*
// @match        https://www.wjx.cn/vm/*
// @match        https://v.wjx.cn/vj/*
// @match        https://www.wjx.cn/vj/*
// @match        https://v.wjx.cn/wjx/join/completemobile2.aspx*
// @match        https://www.wjx.cn/wjx/join/completemobile2.aspx*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'wjx_auto_state';
  const PANEL_ID = 'wjx-auto-panel';
  const SURVEY_URL_KEY = 'wjx_survey_url';

  // ==================== 完成页检测 & 跳回 ====================
  if (window.location.href.includes('/completemobile2.aspx')) {
    const surveyUrl = GM_getValue(SURVEY_URL_KEY, '');
    // 到达完成页 = 提交成功，使用 pendingSubmit 互斥锁防止与 runLoop 重复计数
    const state = GM_getValue(STORAGE_KEY, null) || { totalCount: 10, completedCount: 0, isRunning: false, ratios: {} };
    if (state.pendingSubmit) {
      state.completedCount++;
      state.pendingSubmit = false;
      console.log('[WJX] 🎯 完成页计数: pendingSubmit=true, completedCount=' + state.completedCount);
    } else {
      console.log('[WJX] 🎯 完成页跳过计数: pendingSubmit 已是 false (runLoop 已计数)');
    }
    GM_setValue(STORAGE_KEY, state);

    const displayCount = state.completedCount;
    const displayTotal = state.totalCount;
    const allDone = displayCount >= displayTotal;

    console.log(`[WJX] 🎯 完成页! 计数: ${displayCount}/${displayTotal}, allDone=${allDone}, surveyUrl=${surveyUrl ? '已设置' : '未设置'}`);

    document.body.innerHTML = `
      <div style="text-align:center;padding:80px 20px;font-family:'PingFang SC','Microsoft YaHei',sans-serif;">
        <h2 style="color:#333;">问卷已提交 ✓</h2>
        <p style="color:#5B8DEF;font-size:24px;font-weight:700;margin:16px 0;">${displayCount} / ${displayTotal}</p>
        <p style="color:#888;">${allDone ? '全部完成！' : '即将自动返回问卷继续填写...'}</p>
      </div>`;

    if (allDone) {
      state.isRunning = false;
      GM_setValue(STORAGE_KEY, state);
      console.log('[WJX] 🏁 全部完成! 停止运行');
    } else if (surveyUrl) {
      console.log('[WJX] ⏳ 跳回问卷:', surveyUrl);
      setTimeout(() => { window.location.href = surveyUrl; }, 800);
    } else {
      const params = new URLSearchParams(window.location.search);
      const id = params.get('activityid');
      if (id) {
        const url = `https://v.wjx.cn/vm/${id}.aspx`;
        console.log('[WJX] ⏳ 跳回问卷:', url);
        setTimeout(() => { window.location.href = url; }, 800);
      }
    }
    return;
  }

  // ==================== 工具函数 ====================
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ==================== 问卷解析 ====================
  function parseQuestions() {
    const questions = [];
    document.querySelectorAll('.field.ui-field-contain').forEach(field => {
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

  // ==================== 预计算单选分配池 ====================
  // 使用最大余数法，按权重比例精确分配 N 次提交中每个选项的出现次数
  function buildRadioPools(questions, totalCount, ratiosConfig) {
    const pools = {};
    for (const q of questions) {
      if (!q.isRadio) continue;
      const weights = ratiosConfig[q.name] || q.options.map(() => 1);
      const sum = weights.reduce((a, b) => a + b, 0);
      const counts = new Array(q.options.length).fill(0);

      if (sum <= 0) {
        // 全为 0 → 均匀分配
        const base = Math.floor(totalCount / q.options.length);
        for (let i = 0; i < q.options.length; i++) counts[i] = base;
        let rem = totalCount - base * q.options.length;
        for (let i = 0; i < rem; i++) counts[i]++;
      } else {
        // 最大余数法 (Largest Remainder Method)
        const fractions = weights.map(w => (w / sum) * totalCount);
        for (let i = 0; i < fractions.length; i++) counts[i] = Math.floor(fractions[i]);
        const allocated = counts.reduce((a, b) => a + b, 0);
        let rem = totalCount - allocated;
        // 按小数部分降序排列，余数优先分给小数部分大的选项
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

  // ==================== 表单填写 ====================
  function fillRadio(question, optionIndex) {
    const opt = question.options[optionIndex];
    const input = document.getElementById(opt.id);
    if (!input) return false;
    if (input.checked) return true;
    const anchor = input.parentElement?.querySelector('.jqradio');
    if (anchor) { anchor.click(); return true; }
    return false;
  }

  function fillCheckboxRandom(question) {
    // 纯随机多选: 每个选项 55% 概率选中, 至少选1个
    const selected = [];
    question.options.forEach((opt, i) => {
      if (Math.random() < 0.55) selected.push(i);
    });
    if (selected.length === 0) {
      selected.push(Math.floor(Math.random() * question.options.length));
    }
    // 不选中"以上都不知道"这种互斥选项(在非第一选项位置)
    const hasExclusive = selected.some(i => {
      const label = question.options[i].label;
      return /以上都不|以上没有|不清楚|不太清楚|不知道/.test(label);
    });
    if (hasExclusive && selected.length > 1) {
      // 只保留互斥选项
      const exclusiveIdx = selected.find(i => /以上都不|以上没有|不清楚|不太清楚|不知道/.test(question.options[i].label));
      selected.length = 0;
      selected.push(exclusiveIdx);
    }

    selected.forEach(i => {
      const opt = question.options[i];
      const input = document.getElementById(opt.id);
      if (!input) return;
      if (!input.checked) {
        const anchor = input.parentElement?.querySelector('.jqcheck');
        if (anchor) anchor.click();
      }
    });
    // 取消未选中但已勾选的
    question.options.forEach((opt, i) => {
      if (!selected.includes(i)) {
        const input = document.getElementById(opt.id);
        if (input && input.checked) {
          const anchor = input.parentElement?.querySelector('.jqcheck');
          if (anchor) anchor.click();
        }
      }
    });
    return true;
  }

  function fillText(question) {
    const input = document.querySelector(`input[name="${question.name}"]`);
    if (input) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  function fillAllQuestions(questions, roundIndex, radioPools) {
    let idx = 0;
    let fillLog = [];
    return new Promise(resolve => {
      function next() {
        if (idx >= questions.length) {
          console.log('[WJX] ✍️ 填写完成:', fillLog.join(', '));
          resolve();
          return;
        }
        const q = questions[idx];
        let action = '';
        if (q.isRadio) {
          const pool = radioPools[q.name];
          const optIdx = pool ? pool[roundIndex] : 0;
          fillRadio(q, optIdx);
          action = `${q.name}=opt${optIdx + 1}`;
        } else if (q.isCheckbox) {
          fillCheckboxRandom(q);
          action = `${q.name}=随机多选`;
        } else if (q.isText) {
          fillText(q);
          action = `${q.name}=留空`;
        }
        fillLog.push(action);
        if (q.el) {
          q.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        idx++;
        setTimeout(next, 100 + Math.random() * 150);
      }
      next();
    });
  }

  // ==================== 安全校验弹窗 + 人机验证自动处理 ====================

  // 处理"需要安全校验，请重新提交"弹窗（风控拦截提示）
  async function handleSecurityPopup() {
    console.log('[WJX] 检测安全校验弹窗...');

    // 这个弹窗是 layui 的 layer 对话框，内容包含"安全校验"或"请重新提交"
    // 右下角有蓝色的"确认"按钮
    for (let attempt = 0; attempt < 20; attempt++) {
      // 查找所有可能的 layui layer 弹窗
      const allLayers = document.querySelectorAll(
        '.layui-layer-dialog, .layui-layer, [class*="layui-layer"], ' +
        '.layui-m-layer, [class*="layer-dialog"]'
      );

      for (const layer of allLayers) {
        // 检查是否可见
        if (!layer.offsetParent && getComputedStyle(layer).display === 'none') continue;

        const text = (layer.textContent || '').trim();
        // 匹配风控提示文字
        if (/安全校验|请重新提交|安全验证|风控拦截|校验失败/.test(text)) {
          console.log('[WJX] 找到安全校验弹窗:', text.slice(0, 50));

          // 优先找蓝色"确认"按钮
          const confirmBtn = layer.querySelector(
            '.layui-layer-btn0, .layui-layer-btn .layui-layer-btn0, ' +
            'a.layui-layer-btn0, button, .btn-confirm, .confirm, ' +
            '[class*="btn"][class*="0"], [class*="confirm"]'
          );
          if (confirmBtn && confirmBtn.offsetParent !== null) {
            console.log('[WJX] 点击确认按钮');
            confirmBtn.click();
            confirmBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            await sleep(1500);
            return true;
          }

          // 找文字为"确认"/"确定"的按钮
          const allBtns = layer.querySelectorAll('a, button, .layui-layer-btn');
          for (const btn of allBtns) {
            if (/确认|确定/.test(btn.textContent || '') && btn.offsetParent !== null) {
              console.log('[WJX] 点击按钮(文字匹配):', (btn.textContent || '').trim());
              btn.click();
              await sleep(1500);
              return true;
            }
          }

          // 最后手段：关闭按钮（×）
          const closeBtn = layer.querySelector('.layui-layer-close, .layui-layer-setwin .layui-layer-close');
          if (closeBtn) {
            console.log('[WJX] 点击关闭按钮');
            closeBtn.click();
            await sleep(1500);
            return true;
          }
        }
      }
      await sleep(300);
    }
    return false;
  }

  // ==================== 常驻弹窗拦截 ====================
  // 直接 hook layer.open，比 DOM 轮询更可靠
  function hookLayerDialogs() {
    if (typeof layer === 'undefined' || !layer) {
      // layer 还没加载，500ms 后重试
      setTimeout(hookLayerDialogs, 500);
      return;
    }
    if (layer.__wjx_hooked) return;
    layer.__wjx_hooked = true;

    const _origOpen = layer.open;
    layer.open = function (options) {
      const content = (options && (options.content || '')).toString();
      console.log('[WJX] layer.open 拦截:', content.slice(0, 80));

      // 检测"继续上次回答"弹窗 → 直接不让他弹，或者弹之前就决定
      if (/您之前已经回答了部分题目|是否继续上次回答|继续上次|已经回答了部分题目|恢复答题/.test(content)) {
        console.log('[WJX] 拦截到"继续上次回答"弹窗，自动选择取消...');
        // 直接调用取消逻辑而不显示弹窗
        // WJX 的取消回调通常是 btn2/btn1 或者直接关闭
        if (options && options.btn && Array.isArray(options.btn)) {
          // 找取消按钮的回调
          const cancelIndex = options.btn.findIndex(b => /取消|放弃|重新/.test(b));
          if (cancelIndex >= 0 && options['btn' + (cancelIndex + 1)]) {
            // 直接调用取消回调
            setTimeout(() => {
              try {
                options['btn' + (cancelIndex + 1)].call(this);
              } catch (e) {
                console.log('[WJX] 取消回调执行失败:', e.message);
              }
            }, 100);
            console.log('[WJX] 已调用"继续上次回答"弹窗的取消回调');
            return { __wjx_cancelled: true };
          }
        }
        // 没有取消回调，让弹窗显示但马上关闭
        const inst = _origOpen.call(this, options);
        setTimeout(() => {
          try { layer.close(inst); } catch (e) {}
        }, 200);
        return inst;
      }

      return _origOpen.call(this, options);
    };
    console.log('[WJX] layer.open 已 hook');
  }

  // 处理"您之前已经回答了部分题目，是否继续上次回答"弹窗
  async function handleResumePopup() {
    // 先尝试 hook layer
    hookLayerDialogs();

    // 然后快速文本搜索（最多 3 秒）
    const TARGET = /您之前已经回答了部分题目|是否继续上次回答|继续上次|已经回答了部分题目|恢复答题/;
    for (let attempt = 0; attempt < 10; attempt++) {
      // 检查 divLoadAnswer
      const loadAnswer = document.getElementById('divLoadAnswer');
      if (loadAnswer && loadAnswer.style.display !== 'none' && loadAnswer.offsetHeight > 0) {
        const text = (loadAnswer.textContent || '').trim();
        console.log('[WJX] #divLoadAnswer 可见:', text.slice(0, 120));
        // divLoadAnswer 里可能有"继续"或"取消"按钮
        const btns = loadAnswer.querySelectorAll('a, button, [class*="btn"]');
        for (const btn of btns) {
          if (/取消|放弃|重新开始|从头/.test(btn.textContent || '')) {
            console.log('[WJX] 点击 #divLoadAnswer 中的取消按钮');
            btn.click();
            await sleep(1000);
            return true;
          }
        }
        // 如果有"继续"也有隐藏的"取消"，找取消
        if (/继续上次|恢复答题/.test(text)) {
          // 找不到取消按钮就刷新页面清掉状态
          console.log('[WJX] #divLoadAnswer 检测到恢复提示但无取消按钮，刷新页面');
          location.reload();
          return true;
        }
      }

      // 扫描 layui 弹窗
      const layers = document.querySelectorAll('.layui-layer-dialog, .layui-layer, [class*="layui-layer"]');
      for (const el of layers) {
        if (el.offsetWidth < 50 || el.offsetHeight < 20) continue;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (TARGET.test(el.textContent || '')) {
          console.log('[WJX] 检测到 layui "继续上次回答"弹窗');
          // 找取消按钮
          const btns = el.querySelectorAll('a, button, [class*="btn"]');
          for (const btn of btns) {
            const t = (btn.textContent || '').trim();
            if (/取消|放弃|重新开始|从头/.test(t)) {
              console.log('[WJX] 点击取消按钮:', t);
              btn.click();
              btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              await sleep(1000);
              return true;
            }
          }
          // layui 弹窗: btn0=确认, btn1=取消
          const btn1 = el.querySelector('.layui-layer-btn1');
          if (btn1) {
            console.log('[WJX] 点击 layui btn1 (取消)');
            btn1.click();
            await sleep(1000);
            return true;
          }
          // 关闭按钮
          const close = el.querySelector('.layui-layer-close');
          if (close) {
            console.log('[WJX] 点击关闭按钮');
            close.click();
            await sleep(1000);
            return true;
          }
        }
      }

      // 最后手段：用 innerText 扫 body
      if (TARGET.test(document.body.innerText || '')) {
        console.log('[WJX] body 中有恢复文字，但未找到对应弹窗元素');
      }

      await sleep(300);
    }
    return false;
  }

  // 处理阿里云智能验证
  async function handleAliyunCaptcha() {
    console.log('[WJX] 处理阿里云智能验证...');

    // 先等待 captchaOjb 全局对象就绪（最多等 8 秒）
    for (let attempt = 0; attempt < 40; attempt++) {
      if (typeof captchaOjb !== 'undefined' && captchaOjb && captchaOjb.$button) {
        console.log(`[WJX] captchaOjb 就绪 (attempt=${attempt})`);
        break;
      }
      await sleep(200);
    }

    // ====== 方法 1: 通过全局 captchaOjb 对象点击 ======
    if (typeof captchaOjb !== 'undefined' && captchaOjb) {
      console.log('[WJX] captchaOjb 对象存在, 属性:', Object.keys(captchaOjb).join(', '));

      if (captchaOjb.$button) {
        console.log('[WJX] captchaOjb.$button 存在, 类型:', typeof captchaOjb.$button);
        // 同时触发原生 click 和完整鼠标事件序列
        try {
          captchaOjb.$button.click();
        } catch (e) {
          console.log('[WJX] captchaOjb.$button.click() 异常:', e.message);
        }
        // 如果 $button 是 DOM 元素，派发完整事件
        if (captchaOjb.$button instanceof HTMLElement) {
          const rect = captchaOjb.$button.getBoundingClientRect();
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          captchaOjb.$button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }));
          captchaOjb.$button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }));
          captchaOjb.$button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }));
          console.log('[WJX] 已派发完整鼠标事件到 $button');
        }
        console.log('[WJX] captchaOjb.$button 点击完成, 等待验证...');
        await sleep(3000);
        return true;
      }

      if (typeof captchaOjb.reload === 'function') {
        console.log('[WJX] 调用 captchaOjb.reload()');
        captchaOjb.reload();
        await sleep(2000);
        return true;
      }

      if (typeof captchaOjb.show === 'function') {
        console.log('[WJX] 调用 captchaOjb.show()');
        captchaOjb.show();
        await sleep(800);
      }
    }

    // ====== 方法 2: 查找并点击验证码容器内的按钮/文字 ======
    const captchaWrap = document.getElementById('captchaWrap');
    if (captchaWrap && captchaWrap.offsetParent !== null) {
      console.log('[WJX] captchaWrap 可见, 查找可点击元素');
      // 优先查找"点击开始智能验证"文字或其父元素
      const clickTarget = captchaWrap.querySelector('[class*="btn"], [class*="button"], [class*="click"], [class*="trigger"]')
        || captchaWrap.querySelector('div, span, a');
      if (clickTarget) {
        const rect = clickTarget.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        console.log(`[WJX] 点击 captchaWrap 内元素: ${clickTarget.tagName}.${clickTarget.className}`);
        clickTarget.click();
        clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }));
        clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }));
        clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }));
        await sleep(3000);
        return true;
      }
    }

    // ====== 方法 3: 查找阿里云验证弹窗 ======
    const popup = document.getElementById('aliyunCaptcha-window-popup');
    if (popup && popup.offsetParent !== null) {
      console.log('[WJX] aliyunCaptcha-window-popup 可见');
      const rect = popup.getBoundingClientRect();
      const el = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (el) {
        console.log('[WJX] 点击popup中心元素:', el.tagName, el.className);
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }));
        await sleep(3000);
        return true;
      }
    }

    // ====== 方法 4: jQuery 点击 ======
    try {
      if (typeof $ !== 'undefined') {
        console.log('[WJX] 尝试 jQuery 点击 #captcha, #captchaWrap, #captchabtn');
        $('#captcha').click();
        $('#captchaWrap').click();
        $('#captchabtn').click();
        await sleep(3000);
        return true;
      }
    } catch(e) {
      console.log('[WJX] jQuery 点击异常:', e.message);
    }

    console.log('[WJX] 阿里云验证处理未找到可点击元素');
    return false;
  }

  async function handleSliderFallback() {
    const sliderTrack = document.querySelector('.slider-track, .track, .nc_scale, [class*="slider"], [class*="slide"]');
    if (!sliderTrack || sliderTrack.offsetParent === null) return;

    const btn = sliderTrack.querySelector('[class*="btn"], [class*="handler"], [class*="block"]') || sliderTrack;
    const trackRect = sliderTrack.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const startX = btnRect.left + btnRect.width / 2;
    const startY = btnRect.top + btnRect.height / 2;
    const endX = trackRect.right - btnRect.width / 2 - 2;
    const dist = endX - startX;
    const steps = 25 + Math.floor(Math.random() * 15);

    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: startX, clientY: startY, view: window }));

    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      const eased = progress < 0.7
        ? (progress / 0.7) * (progress / 0.7) * 0.85
        : 0.85 + 0.15 * (1 - Math.pow(1 - (progress - 0.7) / 0.3, 3));
      const cx = startX + dist * eased + (Math.random() - 0.5) * 3;
      const cy = startY + (Math.random() - 0.5) * 4;
      btn.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, view: window }));
      await sleep(12 + Math.random() * 20);
    }
    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: endX, clientY: startY, view: window }));
    await sleep(1500);
  }

  // ==================== 全局 XHR 拦截（一次性 patch） ====================
  const _xhrListeners = [];
  (function patchXHR() {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__url = url;
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      const xhr = this;
      xhr.addEventListener('readystatechange', function () {
        if (xhr.readyState === 4 && xhr.__url && /processjq\.ashx|joinnew\/process/i.test(xhr.__url)) {
          if (xhr.status >= 200 && xhr.status < 400) {
            _xhrListeners.forEach(fn => { try { fn(); } catch (e) {} });
          }
        }
      });
      return origSend.apply(this, arguments);
    };
  })();

  // ==================== 提交检测 ====================
  function detectSubmission() {
    return new Promise(resolve => {
      let settled = false;
      let tid;

      const done = (result) => {
        if (settled) return;
        settled = true;
        console.log(`[WJX] 🔍 detectSubmission done: ${result}, elapsed: ${Date.now() - startTime}ms`);
        clearTimeout(tid);
        if (capPollTimer) clearInterval(capPollTimer);
        observer?.disconnect();
        capObserver?.disconnect();
        window.removeEventListener('beforeunload', onLeave);
        const idx = _xhrListeners.indexOf(onXhrSuccess);
        if (idx >= 0) _xhrListeners.splice(idx, 1);
        resolve(result);
      };

      const startTime = Date.now();
      console.log('[WJX] 🔍 detectSubmission started, timeout=60s');

      const onXhrSuccess = () => { setTimeout(() => done(true), 500); };
      _xhrListeners.push(onXhrSuccess);

      // DOM 检测 - 成功文字
      const observer = new MutationObserver(() => {
        const body = document.body.textContent || '';
        if (/提交成功|感谢.{0,6}参与|问卷已提交|答题完成|答卷成功/.test(body)) {
          done(true);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });

      // 验证码/安全弹窗检测 - MutationObserver + 轮询兜底
      let capPollTimer = null;
      let resumeHandled = false;
      let securityHandled = false;
      let captchaHandled = false;

      const checkPopup = async () => {
        // 第0步: 处理"继续上次回答"弹窗（WJX 恢复答题提示）
        if (!resumeHandled) {
          const allLayers = document.querySelectorAll(
            '.layui-layer-dialog, .layui-layer, [class*="layui-layer"], .layui-m-layer, [class*="layer-dialog"]'
          );
          for (const layer of allLayers) {
            if (!layer.offsetParent && getComputedStyle(layer).display === 'none') continue;
            if (/您之前已经回答了部分题目|是否继续上次回答|继续上次.{0,4}回答|恢复答题|继续作答|上次回答/.test(layer.textContent || '')) {
              resumeHandled = true;
              console.log('[WJX] === 检测到"继续上次回答"弹窗 ===');
              setGlobalMsg('检测到恢复答题弹窗，选择重新开始...', 'warn');
              await handleResumePopup();
              console.log('[WJX] 恢复答题弹窗已处理(选择了取消)');
              break;
            }
          }
        }

        // 第1步: 处理"安全校验"弹窗（layui 风控提示）
        if (!securityHandled) {
          const allLayers = document.querySelectorAll(
            '.layui-layer-dialog, .layui-layer, [class*="layui-layer"], .layui-m-layer, [class*="layer-dialog"]'
          );
          for (const layer of allLayers) {
            if (!layer.offsetParent && getComputedStyle(layer).display === 'none') continue;
            if (/安全校验|请重新提交|安全验证|风控拦截|校验失败/.test(layer.textContent || '')) {
              securityHandled = true;
              console.log('[WJX] === 检测到"安全校验"弹窗 ===');
              setGlobalMsg('检测到安全校验弹窗，自动关闭中...', 'warn');
              await handleSecurityPopup();
              console.log('[WJX] 安全校验弹窗已处理');
              break;
            }
          }
        }

        // 第2步: 处理阿里云验证码（安全弹窗后出现，或直接出现）
        if (!captchaHandled) {
          const captchaOut = document.getElementById('captchaOut');
          const popup = document.getElementById('aliyunCaptcha-window-popup');
          const wrap = document.getElementById('captchaWrap');

          const captchaVisible = captchaOut && (
            captchaOut.style.display !== 'none' ||
            captchaOut.offsetParent !== null ||
            getComputedStyle(captchaOut).display !== 'none'
          );
          const popupVisible = popup && (
            (popup.classList && popup.classList.contains('window-show')) ||
            (popup.offsetParent !== null && getComputedStyle(popup).display !== 'none')
          );
          const wrapVisible = wrap && wrap.offsetParent !== null && getComputedStyle(wrap).display !== 'none';

          if (captchaVisible || popupVisible || wrapVisible) {
            captchaHandled = true;
            console.log('[WJX] === 检测到阿里云验证码 ===');
            setGlobalMsg('检测到人机验证，自动点击中...', 'warn');
            if (capPollTimer) clearInterval(capPollTimer);
            await handleAliyunCaptcha();

            console.log('[WJX] 等待验证后表单自动提交...');
            await sleep(3000);

            if (!settled) {
              console.log('[WJX] 验证后手动重新提交');
              const ctlNext = document.getElementById('ctlNext');
              if (ctlNext) ctlNext.click();
            }
          }
        }

        // 第3步: 滑块验证兜底
        const sliderTrack = document.querySelector('.slider-track, .track, .nc_scale, [class*="slider"], [class*="slide"]');
        if (sliderTrack && sliderTrack.offsetParent !== null && !captchaHandled) {
          captchaHandled = true;
          console.log('[WJX] === 检测到滑块验证 ===');
          setGlobalMsg('检测到滑块验证，自动滑动中...', 'warn');
          await handleSliderFallback();
          console.log('[WJX] 滑块验证已处理');
        }
      };

      const capObserver = new MutationObserver(() => checkPopup());
      capObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
      capPollTimer = setInterval(checkPopup, 500);

      // 页面跳转 — 不在这里计数，由完成页 handler 负责
      const onLeave = () => {
        // 仅标记为"正在提交中"，不调用 done()
        // 计数由完成页或 DOM 检测负责
        console.log('[WJX] beforeunload 触发，等待完成页处理');
      };
      window.addEventListener('beforeunload', onLeave);

      // 超时 60s
      tid = setTimeout(() => done(false), 60000);
    });
  }

  function setGlobalMsg(msg, type) {
    // 同时更新面板和页面中央提示
    setMsg(msg, type);
    // 如果验证码弹窗遮住了面板，在页面上也显示提示
    let globalTip = document.getElementById('wjx-global-tip');
    if (!globalTip) {
      globalTip = document.createElement('div');
      globalTip.id = 'wjx-global-tip';
      globalTip.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:100000001;'
        + 'background:#333;color:#fff;padding:12px 24px;border-radius:10px;font-size:14px;'
        + 'font-family:"PingFang SC","Microsoft YaHei",sans-serif;pointer-events:none;text-align:center;';
      document.body.appendChild(globalTip);
    }
    globalTip.textContent = msg;
    globalTip.style.display = 'block';
    // 3秒后自动隐藏
    clearTimeout(globalTip._tid);
    globalTip._tid = setTimeout(() => { globalTip.style.display = 'none'; }, 3000);
  }

  // ==================== 开始确认弹窗 ====================
  function showStartConfirm(state, questions, radioPools) {
    // 移除旧弹窗
    const old = document.getElementById('wjx-confirm-overlay');
    if (old) old.remove();

    const total = state.totalCount;
    let html = `
      <div class="wjx-cfm-card">
        <div class="wjx-cfm-hdr">确认开始自动填写</div>
        <div class="wjx-cfm-body">
          <p>即将提交 <b style="color:#e74c3c;font-size:18px;">${total}</b> 份问卷</p>
          <div class="wjx-cfm-info">
            <p><b>单选题</b> 按权重分配各选项出现次数</p>
            <p><b>多选题</b> 每份随机选择</p>
            <p><b>填空题</b> 默认留空</p>
            <p><b>人机验证</b> 自动点击通过</p>
          </div>
          <p style="font-size:12px;color:#e67e22;margin-top:10px;">⚠ 如果出现滑块验证，脚本会自动尝试滑动</p>
        </div>`;
    // 显示各单选题的分配情况
    for (const q of questions) {
      if (!q.isRadio) continue;
      const weights = state.ratios[q.name] || q.options.map(() => 1);
      const sum = weights.reduce((a, b) => a + b, 0);
      html += `<div style="font-size:11px;color:#666;margin:4px 0;padding:0 8px;"><b>${q.title.slice(0, 20)}</b>: `;
      html += q.options.map((opt, i) => {
        const cnt = sum > 0 ? Math.round((weights[i] / sum) * total) : Math.round(total / q.options.length);
        return `${opt.label.slice(0, 6)} <b style="color:#5B8DEF;">${cnt}次</b>`;
      }).join(' &nbsp;|&nbsp; ');
      html += '</div>';
    }
    html += `
        <div class="wjx-cfm-btns">
          <button class="wjx-cfm-btn wjx-cfm-go" id="wjx-cfm-start">▶ 开始</button>
          <button class="wjx-cfm-btn wjx-cfm-cancel" id="wjx-cfm-cancel">取消</button>
        </div>
      </div>`;

    const overlay = document.createElement('div');
    overlay.id = 'wjx-confirm-overlay';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    overlay.querySelector('#wjx-cfm-start').addEventListener('click', () => {
      overlay.remove();
      runLoop(questions, state, radioPools);
    });
    overlay.querySelector('#wjx-cfm-cancel').addEventListener('click', () => {
      overlay.remove();
      state.isRunning = false;
      saveState(state);
      const btn = document.getElementById('wjx-start');
      if (btn) btn.textContent = '▶ 开始';
      setMsg('已取消', 'info');
    });
  }

  // ==================== UI 面板 ====================
  function buildPanel(questions) {
    const old = document.getElementById(PANEL_ID);
    if (old) old.remove();

    const state = GM_getValue(STORAGE_KEY, {
      totalCount: 10,
      completedCount: 0,
      isRunning: false,
      ratios: {}
    });

    // 保存问卷地址用于完成页跳回
    GM_setValue(SURVEY_URL_KEY, window.location.href);

    const panel = document.createElement('div');
    panel.id = PANEL_ID;

    // 权重行
    let ratioRows = '';
    for (const q of questions) {
      if (q.isText) continue;
      const saved = state.ratios[q.name] || q.options.map(() => 1);
      const sum = saved.reduce((a, b) => a + b, 0);
      if (q.isRadio) {
        let opts = '';
        q.options.forEach((opt, i) => {
          const w = saved[i] || 0;
          opts += `
            <div class="wjx-opt">
              <span class="wjx-opt-lbl" title="${escHtml(opt.label)}">${trunc(opt.label, 10)}</span>
              <input class="wjx-wt" data-q="${q.name}" data-i="${i}" value="${w}" min="0" max="${state.totalCount}" type="number">
              <span class="wjx-opt-pct">${sum > 0 ? Math.round(w / sum * 100) : 0}%</span>
            </div>`;
        });
        ratioRows += `<div class="wjx-q"><div class="wjx-q-tt">${escHtml(q.title)}<span class="wjx-tag">单选·权重</span></div>${opts}</div>`;
      } else if (q.isCheckbox) {
        ratioRows += `<div class="wjx-q"><div class="wjx-q-tt">${escHtml(q.title)}<span class="wjx-tag">多选·随机</span></div></div>`;
      }
    }

    panel.innerHTML = `
      <div class="wjx-hdr" id="wjx-drag-handle">
        <span class="wjx-logo">WJX 自动填写</span>
        <div class="wjx-hdr-acts">
          <button class="wjx-hdr-btn" id="wjx-toggle-ratio">比例</button>
          <button class="wjx-hdr-btn" id="wjx-toggle-body">−</button>
        </div>
      </div>
      <div id="wjx-body">
        <div class="wjx-sec">
          <div class="wjx-field">
            <label>提交份数</label>
            <input id="wjx-total" class="wjx-inp" type="number" value="${state.totalCount}" min="1" max="9999">
          </div>
          <div class="wjx-stats">
            <div class="wjx-stat"><span class="wjx-stat-num" id="wjx-done">${state.completedCount}</span><span class="wjx-stat-lbl">已完成</span></div>
            <div class="wjx-stat"><span class="wjx-stat-num" id="wjx-left">${Math.max(0, state.totalCount - state.completedCount)}</span><span class="wjx-stat-lbl">剩余</span></div>
          </div>
          <div class="wjx-acts">
            <button class="wjx-btn wjx-btn-main" id="wjx-start">${state.isRunning ? '⏸ 暂停' : '▶ 开始'}</button>
            <button class="wjx-btn wjx-btn-sub" id="wjx-reset">重置</button>
            <button class="wjx-btn wjx-btn-sub" id="wjx-clear-all">清除</button>
          </div>
        </div>
        <div id="wjx-ratio-box" class="wjx-ratio-box" style="display:none;">
          <div class="wjx-ratio-hint">单选权重：数字代表 N 份中该选项出现次数的大致比例（如 1:1:1:1 = 各25%）</div>
          ${ratioRows}
        </div>
        <div id="wjx-msg" class="wjx-msg">就绪，点击「开始」</div>
      </div>
    `;

    document.body.appendChild(panel);
    bindPanelEvents(questions, state);
    makeDraggable();
  }

  function bindPanelEvents(questions, state) {
    // 比例面板
    const ratioBox = document.getElementById('wjx-ratio-box');
    document.getElementById('wjx-toggle-ratio').addEventListener('click', () => {
      const show = ratioBox.style.display === 'none';
      ratioBox.style.display = show ? 'block' : 'none';
      document.getElementById('wjx-toggle-ratio').textContent = show ? '收起' : '比例';
    });

    // 折叠面板
    const bodyEl = document.getElementById('wjx-body');
    document.getElementById('wjx-toggle-body').addEventListener('click', () => {
      const hide = bodyEl.style.display !== 'none';
      bodyEl.style.display = hide ? 'none' : 'block';
      document.getElementById('wjx-toggle-body').textContent = hide ? '+' : '−';
    });

    // 总数
    document.getElementById('wjx-total').addEventListener('change', function () {
      state.totalCount = Math.max(1, parseInt(this.value) || 10);
      this.value = state.totalCount;
      saveState(state);
      refreshStats(state);
    });

    // 权重
    document.querySelectorAll('.wjx-wt').forEach(inp => {
      inp.addEventListener('change', function () {
        const qn = this.dataset.q;
        const i = parseInt(this.dataset.i);
        const val = Math.max(0, parseInt(this.value) || 0);
        this.value = val;
        if (!state.ratios[qn]) {
          const q = questions.find(q => q.name === qn);
          state.ratios[qn] = q ? q.options.map(() => 1) : [];
        }
        state.ratios[qn][i] = val;
        saveState(state);
        // 更新百分比显示
        const sum = state.ratios[qn].reduce((a, b) => a + b, 0);
        document.querySelectorAll(`.wjx-wt[data-q="${qn}"]`).forEach((el, j) => {
          const pctEl = el.nextElementSibling;
          if (pctEl) pctEl.textContent = sum > 0 ? Math.round(state.ratios[qn][j] / sum * 100) + '%' : '0%';
        });
      });
    });

    // 开始
    document.getElementById('wjx-start').addEventListener('click', function () {
      if (state.isRunning) {
        state.isRunning = false;
        saveState(state);
        this.textContent = '▶ 开始';
        setMsg('已暂停', 'warn');
        return;
      }
      state.totalCount = Math.max(1, parseInt(document.getElementById('wjx-total').value) || 10);
      saveState(state);
      // 预计算分配池
      const radioPools = buildRadioPools(questions, state.totalCount, state.ratios);
      // 弹确认窗
      showStartConfirm(state, questions, radioPools);
    });

    // 重置
    document.getElementById('wjx-reset').addEventListener('click', () => {
      state.completedCount = 0;
      state.isRunning = false;
      saveState(state);
      document.getElementById('wjx-start').textContent = '▶ 开始';
      refreshStats(state);
      setMsg('计数已归零', 'info');
    });

    // 清除
    document.getElementById('wjx-clear-all').addEventListener('click', () => {
      if (confirm('清除所有配置和进度？')) {
        GM_setValue(STORAGE_KEY, { totalCount: 10, completedCount: 0, isRunning: false, ratios: {} });
        location.reload();
      }
    });
  }

  function saveState(s) {
    const copy = Object.assign({}, s);
    GM_setValue(STORAGE_KEY, copy);
    console.log('[WJX] 💾 state saved:', JSON.stringify({ total: copy.totalCount, done: copy.completedCount, running: copy.isRunning }));
  }

  function refreshStats(state) {
    const d = document.getElementById('wjx-done');
    const l = document.getElementById('wjx-left');
    if (d) d.textContent = state.completedCount;
    if (l) l.textContent = Math.max(0, state.totalCount - state.completedCount);
  }

  function setMsg(msg, type) {
    const el = document.getElementById('wjx-msg');
    if (el) {
      el.textContent = msg;
      el.className = 'wjx-msg wjx-msg-' + (type || 'info');
      console.log(`[WJX] 📝 ${msg}`);
    }
  }

  // ==================== 主循环 ====================
  async function runLoop(questions, state, radioPools) {
    state.isRunning = true;
    const btn = document.getElementById('wjx-start');
    if (btn) btn.textContent = '⏸ 暂停';
    saveState(state);

    const loopStart = Date.now();
    console.log(`[WJX] 🚀 runLoop 开始: 目标${state.totalCount}份, 已完成${state.completedCount}份, 单选池:`, Object.keys(radioPools).join(','));
    setMsg(`开始: 目标 ${state.totalCount} 份`, 'info');

    while (state.isRunning && state.completedCount < state.totalCount) {
      const round = state.completedCount;
      const roundStart = Date.now();
      console.log(`[WJX] 📋 === 第 ${round + 1}/${state.totalCount} 轮开始 ===`);
      setMsg(`[${round + 1}/${state.totalCount}] 填写中...`, 'info');

      // 每轮开始前检查"继续上次回答"弹窗
      await handleResumePopup();

      await fillAllQuestions(questions, round, radioPools);
      await sleep(300 + Math.random() * 400);

      // 先启动提交检测（含验证码观察），标记 pendingSubmit，再点击提交
      const submitPromise = detectSubmission();
      await sleep(100);

      const submitBtn = document.getElementById('ctlNext');
      if (!submitBtn) {
        setMsg('找不到提交按钮', 'error');
        state.isRunning = false;
        saveState(state);
        return;
      }

      // 关键：提交前设置 pendingSubmit=true，完成页和这里用这个互斥锁防止重复计数
      state.pendingSubmit = true;
      saveState(state);

      submitBtn.click();
      setMsg(`[${round + 1}/${state.totalCount}] 已提交, 等待响应...`, 'info');

      const ok = await submitPromise;
      const roundElapsed = Date.now() - roundStart;

      // 重新从存储读取，检查完成页是否已经计数了
      const storedState = GM_getValue(STORAGE_KEY, state);
      if (ok) {
        if (storedState.pendingSubmit) {
          // 完成页还没计数（页面没跳转或还没执行），我们在这里计数
          state.completedCount = storedState.completedCount + 1;
          state.pendingSubmit = false;
          saveState(state);
          refreshStats(state);
          console.log(`[WJX] ✅ 第 ${state.completedCount}/${state.totalCount} 轮成功 (runLoop计数, 耗时${roundElapsed}ms)`);
          setMsg(`[${state.completedCount}/${state.totalCount}] 提交成功`, 'success');
        } else {
          // 完成页已经计数了，直接同步
          state.completedCount = storedState.completedCount;
          saveState(state);
          refreshStats(state);
          console.log(`[WJX] ✅ 第 ${state.completedCount}/${state.totalCount} 轮成功 (完成页已计数, 耗时${roundElapsed}ms)`);
          setMsg(`[${state.completedCount}/${state.totalCount}] 提交成功`, 'success');
        }
      } else {
        // 超时或失败，清除 pendingSubmit
        state.pendingSubmit = false;
        saveState(state);
        console.log(`[WJX] ⏰ 第 ${round + 1} 轮超时 (耗时${roundElapsed}ms), 刷新重试`);
        setMsg('等待超时，刷新页面...', 'warn');
      }

      if (state.isRunning && state.completedCount < state.totalCount) {
        await sleep(1000 + Math.random() * 800);
        location.reload();
        return;
      }
    }

    if (state.completedCount >= state.totalCount) {
      state.isRunning = false;
      saveState(state);
      setMsg(`全部完成! 共 ${state.completedCount} 份`, 'success');
      if (btn) btn.textContent = '▶ 开始';
    }
  }

  // ==================== 自动恢复 ====================
  function autoResume(questions) {
    const state = GM_getValue(STORAGE_KEY, null);
    if (state && state.isRunning && state.completedCount < state.totalCount) {
      console.log(`[WJX] 🔄 自动恢复: ${state.completedCount}/${state.totalCount}, 1.2s后继续`);
      setMsg(`自动恢复: ${state.completedCount}/${state.totalCount}`, 'info');
      const radioPools = buildRadioPools(questions, state.totalCount, state.ratios);
      setTimeout(() => runLoop(questions, state, radioPools), 1200);
    } else if (state) {
      console.log(`[WJX] 就绪: running=${state.isRunning}, done=${state.completedCount}/${state.totalCount}`);
    }
  }

  // ==================== 拖拽 ====================
  function makeDraggable() {
    const panel = document.getElementById(PANEL_ID);
    const handle = document.getElementById('wjx-drag-handle');
    if (!panel || !handle) return;
    let ox, oy, mx, my;
    handle.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      mx = e.clientX; my = e.clientY;
      const r = panel.getBoundingClientRect();
      ox = r.left; oy = r.top;
      const mv = ev => {
        panel.style.left = (ox + ev.clientX - mx) + 'px';
        panel.style.top = (oy + ev.clientY - my) + 'px';
        panel.style.right = 'auto';
      };
      const up = () => {
        document.removeEventListener('mousemove', mv);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    });
  }

  // ==================== 辅助 ====================
  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
  function trunc(s, n) {
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  // ==================== 样式 ====================
  GM_addStyle(`
    #wjx-auto-panel {
      position:fixed;top:10px;right:10px;width:320px;max-height:94vh;overflow-y:auto;
      background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.15);
      z-index:99999;font:13px/1.5 "PingFang SC","Microsoft YaHei",sans-serif;
      user-select:none;border:1px solid #e2e8f0;
    }
    #wjx-auto-panel *{box-sizing:border-box;margin:0;padding:0;}
    .wjx-hdr{
      background:#fff;padding:12px 16px;border-radius:12px 12px 0 0;
      display:flex;justify-content:space-between;align-items:center;
      border-bottom:1px solid #f0f0f0;cursor:move;
    }
    .wjx-logo{font-size:14px;font-weight:700;color:#1a1a2e;}
    .wjx-hdr-acts{display:flex;gap:6px;}
    .wjx-hdr-btn{
      background:#f5f5f5;color:#555;border:none;border-radius:6px;
      padding:4px 10px;cursor:pointer;font-size:11px;transition:background .15s;
    }
    .wjx-hdr-btn:hover{background:#e8e8e8;}
    #wjx-body{padding:16px;}
    .wjx-sec{display:flex;flex-direction:column;gap:12px;}
    .wjx-field{display:flex;align-items:center;gap:8px;}
    .wjx-field label{font-size:13px;color:#555;white-space:nowrap;}
    .wjx-inp{
      width:80px;padding:6px 10px;border:1.5px solid #e0e0e0;border-radius:8px;
      text-align:center;font-size:14px;outline:none;transition:border .15s;
    }
    .wjx-inp:focus{border-color:#5B8DEF;}
    .wjx-stats{display:flex;gap:20px;justify-content:center;}
    .wjx-stat{display:flex;flex-direction:column;align-items:center;}
    .wjx-stat-num{font-size:24px;font-weight:700;color:#5B8DEF;}
    .wjx-stat-lbl{font-size:11px;color:#999;margin-top:-2px;}
    .wjx-acts{display:flex;gap:8px;justify-content:center;}
    .wjx-btn{
      padding:8px 16px;border:none;border-radius:8px;cursor:pointer;
      font-size:13px;font-weight:600;transition:all .15s;
    }
    .wjx-btn:hover{transform:translateY(-1px);}
    .wjx-btn:active{transform:translateY(0);}
    .wjx-btn-main{background:#5B8DEF;color:#fff;flex:1;}
    .wjx-btn-main:hover{background:#4A7DE0;box-shadow:0 2px 8px rgba(91,141,239,.35);}
    .wjx-btn-sub{background:#f5f5f5;color:#666;font-size:12px;padding:8px 12px;}
    .wjx-btn-sub:hover{background:#eee;}
    .wjx-ratio-box{
      margin-top:12px;padding-top:12px;border-top:1px solid #f0f0f0;
      max-height:45vh;overflow-y:auto;
    }
    .wjx-ratio-hint{font-size:11px;color:#aaa;margin-bottom:10px;line-height:1.5;}
    .wjx-q{margin-bottom:8px;padding:8px 10px;background:#fafbfc;border-radius:8px;border:1px solid #f0f0f0;}
    .wjx-q-tt{font-size:12px;font-weight:600;color:#333;margin-bottom:6px;}
    .wjx-tag{font-weight:400;color:#aaa;font-size:10px;margin-left:6px;}
    .wjx-opt{display:flex;align-items:center;gap:8px;margin:4px 0;}
    .wjx-opt-lbl{flex:1;font-size:11px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .wjx-wt{
      width:44px;padding:3px 4px;border:1.5px solid #e0e0e0;border-radius:6px;
      text-align:center;font-size:12px;outline:none;
    }
    .wjx-wt:focus{border-color:#5B8DEF;}
    .wjx-opt-pct{font-size:11px;color:#5B8DEF;width:36px;text-align:right;}
    .wjx-msg{
      margin-top:12px;padding:8px 12px;border-radius:8px;font-size:12px;text-align:center;
    }
    .wjx-msg-info{background:#f0f4ff;color:#5B8DEF;}
    .wjx-msg-success{background:#edf9ed;color:#389e0d;}
    .wjx-msg-warn{background:#fffbe6;color:#d48806;}
    .wjx-msg-error{background:#fff1f0;color:#cf1322;}

    /* 确认弹窗 */
    #wjx-confirm-overlay{
      position:fixed;top:0;left:0;right:0;bottom:0;
      background:rgba(0,0,0,.4);z-index:100000;
      display:flex;align-items:center;justify-content:center;
      backdrop-filter:blur(2px);
    }
    .wjx-cfm-card{
      background:#fff;border-radius:16px;padding:28px 32px;
      width:420px;max-height:80vh;overflow-y:auto;
      box-shadow:0 16px 48px rgba(0,0,0,.2);text-align:center;
    }
    .wjx-cfm-hdr{font-size:18px;font-weight:700;color:#1a1a2e;margin-bottom:16px;}
    .wjx-cfm-body{font-size:14px;color:#555;line-height:1.8;}
    .wjx-cfm-info{background:#f8f9fc;border-radius:10px;padding:12px 16px;margin:12px 0;text-align:left;}
    .wjx-cfm-info p{font-size:12px;color:#777;margin:4px 0;}
    .wjx-cfm-btns{display:flex;gap:12px;margin-top:20px;justify-content:center;}
    .wjx-cfm-btn{
      padding:10px 32px;border:none;border-radius:10px;cursor:pointer;
      font-size:14px;font-weight:600;transition:all .15s;
    }
    .wjx-cfm-go{background:#5B8DEF;color:#fff;}
    .wjx-cfm-go:hover{background:#4A7DE0;box-shadow:0 4px 12px rgba(91,141,239,.4);}
    .wjx-cfm-cancel{background:#f5f5f5;color:#888;}
    .wjx-cfm-cancel:hover{background:#eee;}
  `);

  // ==================== 入口 ====================
  const questions = parseQuestions();
  if (questions.length === 0) {
    console.log('[WJX] 未检测到问卷题目');
    return;
  }
  console.log(`[WJX] 检测到 ${questions.length} 题:`, questions.map(q => `${q.name}(${q.isRadio ? '单' : q.isCheckbox ? '多' : '填'})`).join(' '));

  // 先建面板（不再等待弹窗检测），hook + 弹窗处理并行
  hookLayerDialogs();
  buildPanel(questions);

  // 后台检查 resume 弹窗，同时启动自动恢复
  handleResumePopup().then(handled => {
    if (handled) console.log('[WJX] 后台处理了"继续上次回答"弹窗');
  });
  autoResume(questions);
})();
