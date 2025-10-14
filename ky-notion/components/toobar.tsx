import { Doc } from "../convex/_generated/dataModel";

interface ToolbarProps {
    initialData: Doc<"documents">;
    preview?: boolean
}

const Toolbar = ({
    initialData,
    preview
}: ToolbarProps) => {
    return ( 
        <div>
            Toolbar
        </div>
     );
}
 
export default Toolbar;