import type { SupabaseClient } from "@supabase/supabase-js";
import { createSearchNotesTool } from "./search-notes";
import { createReadNoteTool } from "./read-note";
import { createCreateNoteTool } from "./create-note";
import { createUpdateNoteTool } from "./update-note";
import { createRenameNoteTool } from "./rename-note";
import { createArchiveNoteTool } from "./archive-note";
import { createDeleteNoteTool } from "./delete-note";

export function createTools(
  supabase: SupabaseClient,
  userId: string,
  pendingNoteId: { current: string | null } = { current: null },
  pendingConfirmDelete: { current: { noteId: string; title: string } | null } = { current: null },
  pendingModifiedNoteId: { current: string | null } = { current: null },
) {
  return {
    searchNotes: createSearchNotesTool(supabase, userId),
    readNote: createReadNoteTool(supabase),
    createNote: createCreateNoteTool(supabase, userId, pendingNoteId),
    updateNote: createUpdateNoteTool(supabase, pendingModifiedNoteId),
    renameNote: createRenameNoteTool(supabase, pendingModifiedNoteId),
    archiveNote: createArchiveNoteTool(supabase, userId),
    deleteNote: createDeleteNoteTool(supabase, userId, pendingConfirmDelete),
  };
}
