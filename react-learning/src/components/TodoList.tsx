import TodoItem from "./TodoItem";
import type { Todo } from "./types";

interface TodoListProps {
    todos: Array<Todo>
    toggleTodo: (id: number) => void
    delTodo: (id: number) => void
}


function TodoList({todos, toggleTodo, delTodo}: TodoListProps) {
    return (
        <ul style={{
            listStyle: 'none',
            padding: 0,
            margin: '20px 0'
        }}>
            {todos.map((todo) => (
                <TodoItem key={todo.id} todo={todo} toggleTodo={toggleTodo} delTodo={delTodo}></TodoItem>
            ))}
        </ul>
    );
}

export default TodoList;