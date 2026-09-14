# 王思洋 · Python 作品集网站

个人作品集站点：展示 Python 数据采集、自动化与数据分析项目，共 **18 个项目**。

**在线访问**：https://wangsy1150.github.io/

---

## 技术特点

- **纯静态**：无后端、无构建步骤，浏览器直接打开即可运行
- **数据驱动**：所有文字与项目数据集中在 `content.js`，改一处全站更新
- **零依赖**：只用原生 JavaScript + CSS，不引入任何框架
- **响应式**：适配桌面与移动端

## 文件结构

```
_portfolio/
├── index.html          ← 页面骨架（含静态占位值，供无 JS 时兜底）
├── content.js          ← ⭐ 唯一数据源：姓名、简介、18 个项目列表
├── script.js           ← 数据绑定与渲染逻辑
├── effects.js          ← 视觉特效（滚动动画、粒子等）
├── style.css           ← 样式
├── Portfolio/          ← 各项目的独立页面
│   ├── bgimgs/         ← 项目卡片封面图
│   └── *.html          ← 项目详情页
└── README.md
```

## 修改内容

**只需改 `content.js` 一个文件。** 顶部是个人信息，下面 `projects` 数组是项目列表：

```javascript
const portfolio = {
  name: "王思洋",
  shortName: "WSY",
  initials: "WSY",
  location: "中国 · 四川",
  email: "714721230@qq.com",
  github: "https://github.com/wangsy1150",
  // ...
  projects: [ /* 18 个项目 */ ]
};
```

保存后刷新网页即可看到变化。

> ⚠️ **修改后记得把版本号 +1**：`index.html` 里引用的是
> `<script src="content.js?v=2"></script>`。
> 改完 `content.js` 内容后，请把 `?v=2` 改成 `?v=3`（以此类推），
> 否则浏览器会继续使用缓存里的旧版本。

## 本地查看

直接双击 `index.html` 即可在浏览器中打开，无需启动服务器。

## 部署说明

本站托管在 **GitHub Pages**：

1. 仓库：`wangsy1150/wangsy1150.github.io`
2. 部署分支：`main`，目录 `/ (root)`
3. 推送后 1~5 分钟自动构建生效

**为什么仓库名必须是 `<用户名>.github.io`**：
这是 GitHub Pages 的规则——只有仓库名**完全等于** `<用户名>.github.io` 时，
站点才会发布到根域名 `https://<用户名>.github.io/`。
若仓库名不同（如写成 `wangsy11500.github.io`），站点会被发布到子路径
`https://<用户名>.github.io/<仓库名>/`，根域名访问会返回 404。

---

*王思洋 · 电子科技大学成都学院 · 计算机科学与技术*
