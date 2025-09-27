import type React from "react"

// 使用function定义
const Article: React.FC<{ title: string; content: string; active: boolean }> = ({
  title,
  content,
  active,
}) => {
  return (
    <div>
      <h1>{title}</h1>
      <p>{content}</p>
      <p>status: {active ? 'active' : 'inactive'}</p>
    </div>
  );
};

export default function App() {
    return (
        <>
            <Article title="hello world" content="hello world content" active></Article>
            <Article title="hello world 2" content="hello world content 2" active></Article>
        </>
    )
}