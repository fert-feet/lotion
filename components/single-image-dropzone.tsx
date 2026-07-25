'use client';

import { SingleImageDropzone } from '@/components/upload/single-image';
import {
  UploaderProvider,
  type UploadFn,
} from '@/components/upload/uploader-provider';
import { createClient } from '@/lib/supabase/client';
import * as React from 'react';

export function SingleImageDropzoneUsage() {
  const uploadFn: UploadFn = React.useCallback(
    async ({ file, onProgressChange, signal }) => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const fileExt = file.name.split(".").pop();
      const path = `uploads/${user.id}/${Date.now()}.${fileExt}`;

      const { error } = await supabase.storage.from("lotion").upload(path, file);
      if (error) throw error;

      const { data: urlData } = supabase.storage.from("lotion").getPublicUrl(path);
      console.log(urlData.publicUrl);
      return { url: urlData.publicUrl };
    },
    [],
  );

  return (
    <UploaderProvider uploadFn={uploadFn} autoUpload>
      <SingleImageDropzone
        dropzoneOptions={{
          maxSize: 1024 * 1024 * 1,
        }}
      />
    </UploaderProvider>
  );
}
