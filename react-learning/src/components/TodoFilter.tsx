import { useState } from 'react';

interface ChangeFilterProps {
    changeFilter: (filterStatus: string) => void
}

function TodoFilter({ changeFilter }: ChangeFilterProps) {
    const [activeFilter, setActiveFilter] = useState('all');

    const handleFilterClick = (filter: string) => {
        setActiveFilter(filter);
        changeFilter(filter);
    };

    const buttonStyle = (filter: string) => ({
        backgroundColor: activeFilter === filter ? '#007bff' : 'transparent',
        color: activeFilter === filter ? 'white' : 'black',
    });

    return (
        <div>
            <button style={buttonStyle('all')} onClick={() => handleFilterClick('all')}>All</button>
            <button style={buttonStyle('active')} onClick={() => handleFilterClick('active')}>Active</button>
            <button style={buttonStyle('completed')} onClick={() => handleFilterClick('completed')}>Completed</button>
        </div>
    );
}

export default TodoFilter