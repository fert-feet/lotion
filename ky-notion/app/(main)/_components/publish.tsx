"use client"

import { Button } from "../../../components/ui/button";
import { Doc } from "../../../convex/_generated/dataModel";

interface publishProps {
    document: Doc<"documents">
}

const Publish = ({
    document
}: publishProps) => {
    return ( 
        <div>
            <Button size="sm">
                publish
            </Button>
        </div>
     );
}
 
export default Publish;