import { createSearchNotesTool } from "./search-notes";
import { createReadNoteTool } from "./read-note";
import { createCreateNoteTool } from "./create-note";

export function createTools(userId: string) {
  return {
    searchNotes: createSearchNotesTool(userId),
    readNote: createReadNoteTool(userId),
    createNote: createCreateNoteTool(userId),
  };
}
