# Sidebar 功能总结

## 概述
本项目中的 Sidebar 是一个响应式侧边栏组件，用于提供应用的主要导航和用户界面控制功能。它采用现代化的 React + Next.js 技术栈实现，具有可调整大小、移动端适配等特性。

## 主要功能组成

### 1. 响应式布局
- **移动端适配**：在移动设备上自动折叠，点击菜单图标展开
- **断点检测**：使用 `useMediaQuery` hook 检测屏幕尺寸
- **动态宽度**：根据设备类型自动调整宽度（手机端：0 或 100%，桌面端：240px）

### 2. 可调整大小
- **拖动调整**：支持通过拖拽右侧边缘调整sidebar宽度
- **宽度限制**：宽度范围限制在 240px - 480px 之间
- **视觉反馈**：拖动时有平滑的过渡动画效果

### 3. 用户信息显示
- **用户头像**：显示用户的 Gravatar 头像
- **用户名展示**：显示 `{username}'s Lotion` 格式的用户名
- **下拉菜单**：点击用户信息显示详细用户菜单

### 4. 导航功能
- **文档列表**：显示 "Documents" 标题，为后续文档列表预留位置
- **状态切换**：支持展开/折叠状态切换
- **路由感知**：根据当前路径自动处理导航状态

### 5. 用户操作菜单
- **用户设置**：显示用户邮箱信息
- **退出登录**：提供 Sign Out 功能
- **头像显示**：在下拉菜单中显示完整的用户头像和用户名

## 技术实现细节

### 核心技术栈
- **React 18**：使用函数组件和 Hooks
- **Next.js 14**：App Router 和 Server Components
- **TypeScript**：完整的类型支持
- **Tailwind CSS**：样式系统
- **Clerk**：用户认证
- **Convex**：后端数据库

### 关键组件

#### Navigation 组件 (`app/(main)/_components/navigation.tsx`)
- **状态管理**：使用 `useState` 管理展开/折叠状态
- **引用管理**：使用 `useRef` 管理 DOM 元素引用
- **事件处理**：处理鼠标拖动、点击等交互
- **响应式逻辑**：根据屏幕尺寸自动调整布局

#### UserItem 组件 (`app/(main)/_components/user-item.tsx`)
- **用户信息**：使用 Clerk 的 `useUser` hook 获取用户数据
- **下拉菜单**：使用自定义的 Dropdown 组件
- **退出功能**：集成 Clerk 的 `SignOutButton`

### 样式系统
- **CSS 变量**：定义了完整的 sidebar 主题变量
- **Tailwind 类名**：使用 Tailwind 的实用类进行样式控制
- **暗色模式**：支持深色主题
- **过渡动画**：使用 CSS transition 实现平滑动画

### 交互逻辑

#### 宽度调整逻辑
```typescript
const handleMouseMove = (e: MouseEvent) => {
    if (!isResizingRef.current) return;
    let newWidth = e.clientX
    
    // 限制宽度范围
    if (newWidth < 240) newWidth = 240
    if (newWidth > 480) newWidth = 480
    
    // 更新sidebar和navbar的宽度
    sidebarRef.current.style.width = `${newWidth}px`
    navbarRef.current.style.setProperty("left", `${newWidth}px`)
    navbarRef.current.style.setProperty("width", `calc(100% - ${newWidth}px)`)
}
```

#### 响应式逻辑
```typescript
useEffect(() => {
    if (isMobile) {
        collapse();  // 手机端自动折叠
    } else {
        resetWidth() // 桌面端恢复默认宽度
    }
}, [isMobile])
```

## 文件结构
```
app/(main)/
├── _components/
│   ├── navigation.tsx    # 主侧边栏组件
│   └── user-item.tsx     # 用户信息组件
├── layout.tsx            # 主布局组件
└── (routes)/
    └── documents/
        └── page.tsx      # 文档页面
```

## 设计特点

### 用户体验
- **直观操作**：拖拽调整、点击展开/折叠
- **状态持久**：保持用户的偏好设置
- **流畅动画**：所有状态变化都有过渡效果
- **视觉层次**：清晰的视觉层次和信息架构

### 技术特点
- **组件化**：模块化设计，易于维护
- **类型安全**：完整的 TypeScript 类型定义
- **性能优化**：使用 React 最佳实践
- **可访问性**：支持键盘导航和屏幕阅读器

## 扩展性
当前实现为后续功能预留了扩展点：
- 文档列表区域可进一步扩展显示文档树
- 搜索功能可以集成到sidebar中
- 可以添加更多用户设置选项
- 支持自定义主题和布局配置