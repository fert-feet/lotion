import { useEffect, useState } from "react";

const useOrigin = () => {
    const [mounted, setMounted] = useState(false)

    // origin 为 protocol + domain + port 就是整个网址，比如 http://localhost:3000
    // TODO 搞懂什么是服务端、客户端渲染 
    const origin = (typeof window !== "undefined" && window.location.origin) ? window.location.origin : ""

    useEffect(() => {
        setMounted(true)
    }, [])

    if (!mounted) {
        return "" 
    }

    return origin
}

export default useOrigin;