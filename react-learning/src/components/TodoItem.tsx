import type { Todo } from "./types";

interface TodoItemProps {
    todo: Todo,
    toggleTodo: (id: number) => void,
    delTodo: (id: number) => void
}

function TodoItem({ todo, toggleTodo, delTodo }: TodoItemProps) {
    return (
        <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            margin: '8px 0',
            backgroundColor: todo.completed ? '#e8f5e9' : '#fff',
            border: `1px solid ${todo.completed ? '#4caf50' : '#ccc'}`,
            borderRadius: '6px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
            transition: 'all 0.3s ease'
        }}>
            <div style={{
                display: 'flex',
                alignItems: 'center',
                textDecoration: todo.completed ? 'line-through' : 'none',
                color: todo.completed ? '#757575' : '#333',
                opacity: todo.completed ? 0.8 : 1
            }}>
                <input
                    type="checkbox"
                    checked={todo.completed}
                    onChange={() => toggleTodo(todo.id)}
                    style={{
                        marginRight: '12px',
                        transform: 'scale(1.2)'
                    }}
                />
                <span>{todo.text}</span>
            </div>
            <button 
                onClick={() => delTodo(todo.id)}
                style={{
                    backgroundColor: '#f44336',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '6px 12px',
                    cursor: 'pointer',
                    transition: 'background-color 0.3s ease'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#d32f2f'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f44336'}
            >
                Delete
            </button>
        </div>
    );
}

export default TodoItem;