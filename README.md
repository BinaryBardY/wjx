# 问卷星自动填写助手 (WJX Auto Fill)

一个 Tampermonkey / 脚本猫 用户脚本，用于自动填写并提交问卷星（wjx.cn）问卷。支持自定义提交次数、单选题选项权重分配，以及自动处理常见弹窗和人机验证。

## 背景

本项目代码由 **DeepSeek** 辅助生成。由于 DeepSeek 是纯文本模型，**无法看到图片**（是个"瞎子"），无法生成自动人机验证模块，所以在人机验证环节只能通过人工点击按钮来尝试通过。

因此：

> **脚本可以自动填写问卷内容，但不能保证绕过所有类型的人机验证。**

遇到复杂图形验证码时，仍需人工介入完成验证，之后脚本会继续自动运行。

## 功能

- **自动填写**：单选题按预设权重智能分配选项，多选题随机勾选，填空题留空
- **批量提交**：可设置提交份数（1–9999），自动循环填写并提交
- **权重控制**：为每道单选题的各个选项设置出现次数比例（如 1:1:1:1 = 各25%）
- **弹窗处理**：自动关闭"继续上次回答"提示弹窗、安全校验弹窗
- **进度持久化**：刷新/关闭页面后自动恢复，不丢进度
- **可拖拽面板**：控制面板可自由拖拽，不影响浏览问卷

## 安装

### 1. 安装 Tampermonkey / 脚本猫 浏览器扩展

| 浏览器 | 扩展 | 安装地址 |
|--------|------|---------|
| Chrome / Edge | Tampermonkey | [Tampermonkey - Chrome Web Store](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) |
| Chrome / Edge | 脚本猫 | [脚本猫 - Chrome Web Store](https://chromewebstore.google.com/detail/scriptcat/ndcooeababalnlpkfedmmbbbgkljhpjf) |
| Firefox | Tampermonkey | [Tampermonkey - Firefox Add-ons](https://addons.mozilla.org/firefox/addon/tampermonkey/) |
| Firefox | 脚本猫 | [脚本猫 - Firefox Add-ons](https://addons.mozilla.org/firefox/addon/scriptcat/) |
| Safari | Tampermonkey | [Tampermonkey - Mac App Store](https://apps.apple.com/app/tampermonkey/id1482490089) |

### 2. 安装脚本

**方法一：一键安装（推荐）**

1. 点击 Tampermonkey / 脚本猫 图标 → **管理面板** → **实用工具**
2. 在「从 URL 安装」输入框中粘贴以下地址，点击「安装」：

```
https://raw.githubusercontent.com/BinaryBardY/wjx/main/wjx-auto-fill.user.js
```

**方法二：手动安装**

1. 点击 Tampermonkey / 脚本猫 图标 → **创建新脚本**
2. 清空编辑器，将 `wjx-auto-fill.user.js` 的全部内容粘贴进去
3. `Ctrl + S` 保存

### 3. 使用

1. 打开任意问卷星问卷页面（`v.wjx.cn/vm/*` 或 `www.wjx.cn/vm/*`）
2. 页面右上角会出现 **WJX 自动填写** 控制面板
3. 设置提交份数和各题选项权重（点击「比例」展开）
4. 点击 **「开始」** 按钮，确认后脚本自动运行
5. 如遇到图形验证码，请**手动完成**后脚本继续

## 项目结构

```
├── .gitignore
├── README.md
├── wjx-auto-fill.user.js    # 核心用户脚本
├── test-core-logic.js       # 核心逻辑单元测试
├── test-browser.js          # 浏览器端 Playwright 测试
└── package.json             # 测试依赖（jsdom, playwright）
```

## 注意事项

- 本脚本仅供学习交流使用，请遵守问卷星平台的使用条款
- 遇到滑块拼图、文字点选等图形验证码时需人工介入
- 提交间隔设有随机延迟，但仍需注意不要对目标服务器造成过大压力

## License

MIT
