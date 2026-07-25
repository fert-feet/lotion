import type { SupabaseClient } from "@supabase/supabase-js";
import { createSearchNotesTool } from "./search-notes";
import { createReadNoteTool } from "./read-note";
import { createCreateNoteTool } from "./create-note";

export function createTools(
  supabase: SupabaseClient,
  userId: string,
  createdNoteIds: string[] = [],
) {
  return {
    searchNotes: createSearchNotesTool(supabase, userId),
    readNote: createReadNoteTool(supabase),
    createNote: createCreateNoteTool(supabase, userId, createdNoteIds),
  };
}
