import React, { useState } from "react";

interface AddTodoProps {
    addTodo: (text: string) => void
}

function AddTodo({addTodo} : AddTodoProps) {
    const [text, setText] = useState('')

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (text.trim() === '') {
            return
        }

        addTodo(text)
        setText('')
    }

    return (
        <form onSubmit={handleSubmit} style={{
            display: 'flex',
            marginBottom: '20px',
            gap: '10px'
        }}>
            <input 
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Enter a new task..."
                style={{
                    flex: 1,
                    padding: '12px',
                    border: '1px solid #ccc',
                    borderRadius: '6px',
                    fontSize: '16px',
                    outline: 'none',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                }}
            />
            <button 
                type="submit"
                style={{
                    padding: '12px 20px',
                    backgroundColor: '#4caf50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '16px',
                    transition: 'background-color 0.3s ease'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#45a049'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#4caf50'}
            >
                Add Task
            </button>
        </form>
    );
}

export default AddTodo;