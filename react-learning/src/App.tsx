// 子组件给父组件传递信息

import { useState } from "react";

function Test({onActive}: {onActive: (status: boolean) => void}) {
    const [status, setStatus] = useState(true)

    function handleClick() {
        setStatus(!status)
        onActive(status)
    }

    return (
        <div>
            <p style={{ display: status ? 'block' : 'none' }}>content</p>
            <button onClick={handleClick}>button</button>
        </div>
    )
}


export default function App() {
    function handleStatus(status: boolean) {
        console.log(status);
    }
    return (
        <>
            <Test onActive={handleStatus}></Test>
        </>
    );
}