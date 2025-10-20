# Landing Page 前端实现总结

## 项目结构
- `app/(marketing)/layout.tsx`: 定义了营销页面的布局，包含导航栏和主要内容区域。
- `app/(marketing)/page.tsx`: 营销页面的主体内容，由 `Heading`, `Heroes`, 和 `Footer` 组件构成。
- `app/(marketing)/_components/`: 包含所有营销页面的子组件。

## 主要组件及功能

### 1. Navbar (导航栏)
- **文件**: `navbar.tsx`
- **功能**:
  - 固定在页面顶部 (`fixed top-0`)，具有高 z-index (`z-50`) 确保在最上层。
  - 使用 `useScrollTop` hook 监听页面滚动，当用户向下滚动超过 10px 时，动态添加底部边框 (`border-b`) 和小尺寸阴影 (`shadow-sm`)，提升用户体验。
  - 包含 Logo 组件和登录/注册按钮。
  - 使用 Tailwind CSS 实现响应式布局，按钮在中等及以上屏幕尺寸上靠右对齐。

### 2. Logo (标志)
- **文件**: `logo.tsx`
- **功能**:
  - 使用 Next.js 的 `next/font` 优化 Google Fonts (Poppins) 的加载。
  - 使用 `next/image` 组件显示 SVG 格式的 Logo 图片 (`/logo.svg`)。
  - 在中等及以上屏幕尺寸上显示 Logo 和文字 "Lotion"，在小屏幕上隐藏。

### 3. Heading (标题)
- **文件**: `heading.tsx`
- **功能**:
  - 展示应用的主标题和副标题，使用响应式字体大小。
  - 主标题包含带有下划线的品牌名 "Lotion"。
  - 提供一个 "Enter Lotion" 按钮，带有右箭头图标，用于引导用户进入应用。

### 4. Heroes (宣传图)
- **文件**: `heroes.tsx`
- **功能**:
  - 用于展示宣传图片的容器。
  - 目前图片内容被注释掉了，但结构上支持在不同屏幕尺寸上显示不同的图片。

### 5. Footer (页脚)
- **文件**: `footer.tsx`
- **功能**:
  - 固定在页面底部。
  - 包含 Logo 和 "Privacy Policy" 以及 "Terms & Conditions" 按钮。
  - 使用 Tailwind CSS 实现响应式布局。

## 技术亮点
- **响应式设计**: 广泛使用 Tailwind CSS 的响应式前缀 (如 `md:`, `sm:`) 来适配不同屏幕尺寸。
- **动态样式**: 使用 `cn` 工具函数结合 `clsx` 和 `tailwind-merge` 来动态处理和合并 CSS 类名，实现条件样式。
- **组件化**: 将页面拆分为多个可复用的组件，结构清晰，易于维护。
- **性能优化**: 使用 Next.js 的 `next/font` 和 `next/image` 来优化字体和图片加载。