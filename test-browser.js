#!/usr/bin/env node
'use strict';

const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  // Collect console logs
  page.on('console', msg => console.log(`  [BROWSER ${msg.type()}] ${msg.text()}`));

  console.log('=== 打开问卷页面 ===');
  await page.goto('https://v.wjx.cn/vm/wFhgGhJ.aspx', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000); // Wait for any dialogs to appear

  // Dump page info
  const title = await page.title();
  console.log(`页面标题: ${title}`);
  console.log(`URL: ${page.url()}`);

  // Check for dialogs/modals
  console.log('\n=== 检查弹窗/对话框 ===');
  const dialogs = await page.evaluate(() => {
    const results = [];
    // Check layui layers
    const layers = document.querySelectorAll('.layui-layer, .layui-layer-dialog, [class*="layui-layer"]');
    layers.forEach(el => {
      const style = getComputedStyle(el);
      results.push({
        type: 'layui-layer',
        visible: style.display !== 'none',
        text: (el.textContent || '').trim().slice(0, 100),
        className: el.className,
        id: el.id,
        rect: el.getBoundingClientRect()
      });
    });

    // Check #divLoadAnswer
    const loadAnswer = document.getElementById('divLoadAnswer');
    if (loadAnswer) {
      results.push({
        type: 'divLoadAnswer',
        visible: loadAnswer.style.display !== 'none',
        text: (loadAnswer.textContent || '').trim().slice(0, 200),
        display: loadAnswer.style.display
      });
    }

    // Check for any fixed position overlays with high z-index
    document.querySelectorAll('div, section').forEach(el => {
      const style = getComputedStyle(el);
      const zIndex = parseInt(style.zIndex);
      if (zIndex > 100 && style.position === 'fixed' && el.offsetWidth > 200) {
        results.push({
          type: 'fixed-overlay',
          zIndex,
          text: (el.textContent || '').trim().slice(0, 100),
          className: el.className,
          id: el.id
        });
      }
    });

    return results;
  });
  console.log(JSON.stringify(dialogs, null, 2));

  // Check for resume-related text
  console.log('\n=== 检查恢复答题相关文字 ===');
  const resumeText = await page.evaluate(() => {
    const body = document.body.innerText || '';
    const matchResume = body.match(/您之前已经回答了|继续上次|恢复答题|已经回答了部分/);
    return { found: !!matchResume, match: matchResume ? matchResume[0] : null, bodySnippet: body.slice(0, 500) };
  });
  console.log(JSON.stringify(resumeText, null, 2));

  // Check for window.layer
  console.log('\n=== 检查 layer 对象 ===');
  const layerInfo = await page.evaluate(() => {
    return {
      layerExists: typeof layer !== 'undefined',
      layerType: typeof layer,
      layerKeys: typeof layer !== 'undefined' && layer ? Object.keys(layer).slice(0, 20) : [],
      captchaOjbExists: typeof captchaOjb !== 'undefined',
      captchaOjbType: typeof captchaOjb,
      captchaOjbKeys: typeof captchaOjb !== 'undefined' && captchaOjb ? Object.keys(captchaOjb).slice(0, 20) : [],
    };
  });
  console.log(JSON.stringify(layerInfo, null, 2));

  // Check form structure
  console.log('\n=== 检查问卷表单结构 ===');
  const formInfo = await page.evaluate(() => {
    const fields = [];
    document.querySelectorAll('.field.ui-field-contain').forEach(field => {
      const type = field.getAttribute('type');
      const name = field.querySelector('input')?.name || '';
      const title = field.querySelector('.topichtml')?.textContent?.trim().slice(0, 50) || '';
      const opts = [];
      if (type === '3') {
        field.querySelectorAll('input[type="radio"]').forEach(inp => {
          const label = field.querySelector(`label[for="${inp.id}"]`)?.textContent?.trim().slice(0, 30) || '';
          opts.push({ id: inp.id, value: inp.value, label });
        });
      } else if (type === '4') {
        field.querySelectorAll('input[type="checkbox"]').forEach(inp => {
          const label = field.querySelector(`label[for="${inp.id}"]`)?.textContent?.trim().slice(0, 30) || '';
          opts.push({ id: inp.id, value: inp.value, label });
        });
      }
      fields.push({ name, type, title, optCount: opts.length, opts: opts.slice(0, 3) });
    });
    return {
      totalFields: fields.length,
      fields,
      submitBtnExists: !!document.getElementById('ctlNext'),
      submitBtnText: document.getElementById('ctlNext')?.textContent?.trim(),
      formAction: document.getElementById('form1')?.getAttribute('action'),
      captchaOutExists: !!document.getElementById('captchaOut'),
      captchaWrapExists: !!document.getElementById('captchaWrap'),
    };
  });
  console.log(JSON.stringify(formInfo, null, 2));

  // Test: try clicking a radio option (jqradio anchor)
  console.log('\n=== 测试: 点击第一个单选题 ===');
  const radioResult = await page.evaluate(() => {
    const firstRadio = document.querySelector('.field.ui-field-contain[type="3"]');
    if (!firstRadio) return { error: 'no radio field found' };
    const firstOpt = firstRadio.querySelector('input[type="radio"]');
    if (!firstOpt) return { error: 'no radio input found' };
    const jqradio = firstOpt.parentElement?.querySelector('.jqradio');
    if (!jqradio) return { error: 'no jqradio anchor', parentHTML: firstOpt.parentElement?.innerHTML?.slice(0, 200) };
    jqradio.click();
    return {
      success: true,
      optId: firstOpt.id,
      optLabel: firstRadio.querySelector(`label[for="${firstOpt.id}"]`)?.textContent?.trim(),
      checked: firstOpt.checked
    };
  });
  console.log(JSON.stringify(radioResult, null, 2));

  // Take screenshot at this point
  await page.screenshot({ path: '/Users/neo/MyData/study/course/2026/Spring/习思想/实践作业/wjx/survey-initial.png', fullPage: true });
  console.log('\n截图已保存: survey-initial.png');

  // Now try to fill all questions and find the submit button
  console.log('\n=== 测试: 填写所有题目 ===');
  const fillResult = await page.evaluate(() => {
    const log = [];
    document.querySelectorAll('.field.ui-field-contain').forEach(field => {
      const type = field.getAttribute('type');
      const name = field.querySelector('input')?.name || '';
      if (type === '3') {
        // Radio - click first option's jqradio
        const firstRadio = field.querySelector('input[type="radio"]');
        if (firstRadio) {
          const jqradio = firstRadio.parentElement?.querySelector('.jqradio');
          if (jqradio) {
            jqradio.click();
            log.push(`RADIO ${name}: clicked ${firstRadio.id}`);
          }
        }
      } else if (type === '4') {
        // Checkbox - click first option's jqcheck
        const firstCheck = field.querySelector('input[type="checkbox"]');
        if (firstCheck) {
          const jqcheck = firstCheck.parentElement?.querySelector('.jqcheck');
          if (jqcheck) {
            jqcheck.click();
            log.push(`CHECK ${name}: clicked ${firstCheck.id}`);
          }
        }
      } else if (type === '1') {
        // Text - leave empty
        log.push(`TEXT ${name}: skipped`);
      }
    });
    return log;
  });
  console.log(fillResult.join('\n'));

  // Screenshot after filling
  await page.screenshot({ path: '/Users/neo/MyData/study/course/2026/Spring/习思想/实践作业/wjx/survey-filled.png', fullPage: true });
  console.log('截图已保存: survey-filled.png');

  // Click submit and observe what happens
  console.log('\n=== 测试: 点击提交按钮 ===');
  const submitBtn = await page.$('#ctlNext');
  if (submitBtn) {
    // Set up dialog listener before clicking
    await page.evaluate(() => {
      // Hook layer to capture dialog info
      if (typeof layer !== 'undefined' && layer && !layer.__test_hooked) {
        layer.__test_hooked = true;
        const orig = layer.open;
        layer.open = function(opts) {
          console.log('[TEST-HOOK] layer.open called with content:', JSON.stringify((opts && opts.content || '').toString().slice(0, 200)));
          return orig.call(this, opts);
        };
      }
    });

    await submitBtn.click();
    console.log('已点击提交按钮，等待5秒观察结果...');
    await page.waitForTimeout(5000);

    // Check what happened
    const afterSubmit = await page.evaluate(() => {
      const body = document.body.textContent || '';
      return {
        url: window.location.href,
        isCompletionPage: window.location.href.includes('completemobile2'),
        successText: body.match(/提交成功|感谢.{0,10}参与|问卷已提交|答题完成|答卷成功|安全校验|请重新提交|点击开始智能验证/),
        bodySnippet: body.slice(0, 500),
        captchaVisible: (() => {
          const out = document.getElementById('captchaOut');
          return out ? (out.style.display !== 'none' && out.offsetHeight > 0) : false;
        })(),
        hasLayers: document.querySelectorAll('.layui-layer, .layui-layer-dialog').length,
        layerTexts: Array.from(document.querySelectorAll('.layui-layer, .layui-layer-dialog')).map(el => (el.textContent || '').trim().slice(0, 100)),
        divLoadAnswerVisible: (() => {
          const d = document.getElementById('divLoadAnswer');
          return d ? (d.style.display !== 'none' && d.offsetHeight > 0) : false;
        })(),
        divLoadAnswerText: (() => {
          const d = document.getElementById('divLoadAnswer');
          return d ? (d.textContent || '').trim().slice(0, 200) : 'NOT FOUND';
        })(),
      };
    });
    console.log(JSON.stringify(afterSubmit, null, 2));

    // Screenshot after submit
    await page.screenshot({ path: '/Users/neo/MyData/study/course/2026/Spring/习思想/实践作业/wjx/survey-after-submit.png', fullPage: true });
    console.log('截图已保存: survey-after-submit.png');
  } else {
    console.log('ERROR: 找不到提交按钮 #ctlNext');
  }

  await browser.close();
  console.log('\n=== 测试完成 ===');
})().catch(err => {
  console.error('测试失败:', err.message);
  process.exit(1);
});
