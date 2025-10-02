import { useState, useEffect } from "react";

const useScrollTop = (threshold = 10) => {
    const [scrolled, setScrolled] = useState(false)

    useEffect(() => {
        const handleScroll = () => {
            if (window.scrollY > threshold) {
                setScrolled(true)
            } else {
                setScrolled(false)
            }
        }

        window.addEventListener("scroll", handleScroll);
        return () => window.removeEventListener("scroll", handleScroll)
    }, [threshold])

    return scrolled
}
// todo: notes: effect
// import { useState, useEffect } from 'react';

// function Counter() {
//   const [count, setCount] = useState(0);

//   // 点击按钮后，标题跟着更新
//   useEffect(() => {
//     document.title = `你点击了 ${count} 次`; // 手动修改 DOM（document 是浏览器的 DOM）
//   }, [count]); // 只有 count 变了，才重新改标题

//   return <button onClick={() => setCount(count + 1)}>点我</button>;
// }
export default useScrollTop;