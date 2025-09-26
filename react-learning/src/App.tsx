import { useState } from 'react'
import './App.css'

function App() {
  const [count, numCount] = useState(0)

  return (
    <>
      <h1>Vite + React</h1>
      <div className="card">
        {/* numCount 接收一个数，返回更新状态，重新渲染，不能 count = count + 1 */}
        <button onClick={() => numCount((count) => count + 1)}>
          porn is {count}
        </button>
        <p>
          Edit <code>src/App.tsx</code> and save to test HMR
        </p>
      </div>
    </>
  )
}

export default App
