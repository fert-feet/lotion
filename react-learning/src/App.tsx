import { useState } from 'react'
import './App.css'
import AddTodo from './components/AddTodo'
import TodoFilter from './components/TodoFilter'
import TodoList from './components/TodoList'
import type { Todo } from './components/types'

function App() {
  const [todos, setTodos] = useState<Todo[]>([]) 
  const [filter, setFilter] = useState<string>('all')

  const addTodo = (text: string) => {
    const newTodo = {
      id: Date.now(),
      text: text,
      completed: false
    }
    setTodos([...todos, newTodo])
  }

  const delTodo = (id: number) => {
    setTodos(todos.filter(todo => todo.id !== id))
  }

  const toggleTodo = (id: number) => {
    setTodos(todos.map(todo => {
      if (todo.id === id) {
        todo.completed = !todo.completed
      }
      return todo
    }))
  }

  const getFilteredTodos = () => {
    switch (filter) {
      case 'completed':
        return todos.filter(todo => todo.completed)
      case 'active':
        return todos.filter(todo => !todo.completed)
      default:
        return todos
    }
  }

  const setFilterFunc = (filterStatus: string) => {
    setFilter(filterStatus)
  }

  return (
    <div style={{
      maxWidth: '600px',
      margin: '40px auto',
      padding: '20px',
      fontFamily: 'Arial, sans-serif',
      backgroundColor: '#f8f9fa',
      borderRadius: '10px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
    }}>
      <h1 style={{
        textAlign: 'center',
        color: '#333',
        marginBottom: '30px',
        paddingBottom: '15px',
        borderBottom: '2px solid #eee'
      }}>Todo List</h1>
      <AddTodo addTodo={addTodo}></AddTodo>
      <TodoList todos={getFilteredTodos()} delTodo={delTodo} toggleTodo={toggleTodo}></TodoList>
      <TodoFilter changeFilter={setFilterFunc}></TodoFilter>
    </div>
  )
}

export default App



