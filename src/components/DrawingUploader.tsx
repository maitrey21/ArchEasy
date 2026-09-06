import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Upload, Loader2, Layers } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { errorMessage, readJsonResponse, type AnalyzeDrawingResponse } from "@/lib/types";

interface Props {
  projectId: string;
  /** Drawings and detected rooms are scoped to this floor. */
  floorId: string | null;
  /** Passed to the AI so every detected room gets the right floor_level. */
  floorName: string;
}

export default function DrawingUploader({ projectId, floorId, floorName }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string>("");

  const uploadAndAnalyze = useMutation({
    mutationFn: async (file: File) => {
      if (!floorId) {
        throw new Error("Select or create a floor before uploading a drawing.");
      }

      // Vercel serverless functions hard-cap the request body at 4.5MB, and the
      // file gets base64-encoded (~33% larger) before it's sent. Catch this
      // client-side with a clear message instead of letting the platform's
      // opaque 413 response reach the JSON parser.
      const MAX_ANALYZE_FILE_BYTES = 3 * 1024 * 1024; // 3MB raw -> ~4MB base64
      if (file.size > MAX_ANALYZE_FILE_BYTES) {
        throw new Error(
          `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)}MB, which is too large for AI analysis (max 3MB). Try compressing the image or exporting a lower-resolution version.`
        );
      }

      setUploading(true);
      setProgress("Uploading...");

      // Storage path is grouped by floor so files stay organised per level.
      const storagePath = `${user!.id}/${projectId}/${floorId}/${Date.now()}_${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("drawings")
        .upload(storagePath, file);
      if (uploadError) throw uploadError;

      setProgress("Saving record...");
      const { data: drawing, error: insertError } = await supabase
        .from("drawings")
        .insert({
          project_id: projectId,
          floor_id: floorId,
          user_id: user!.id,
          file_name: file.name,
          storage_path: storagePath,
          file_size: file.size,
          analysis_status: "analyzing",
        })
        .select()
        .single();
      if (insertError) throw insertError;

      // Convert file to base64 for AI analysis
      setProgress("Detecting rooms with AI...");
      const base64 = await fileToBase64(file);

      try {
        // The Gemini key lives only on the server (/api/analyze-drawing), so it
        // is never shipped to the browser. We forward the user's Supabase access
        // token so the endpoint can reject anonymous callers.
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) throw new Error("Your session expired. Please sign in again.");

        const res = await fetch("/api/analyze-drawing", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            imageBase64: base64,
            fileName: file.name,
            mimeType: file.type,
            floorName,
          }),
        });

        const analysisData = await readJsonResponse<AnalyzeDrawingResponse>(res);
        if (!res.ok) throw new Error(analysisData?.error || `Analysis failed (${res.status})`);

        setProgress("Saving rooms...");
        const rooms = Array.isArray(analysisData.rooms) ? analysisData.rooms : [];

        if (rooms.length > 0) {
          const roomInserts = rooms.map((room) => ({
            drawing_id: drawing.id,
            project_id: projectId,
            floor_id: floorId,
            user_id: user!.id,
            name: room.name || "Unnamed Room",
            // Trust the floor the user is working on over whatever the model read.
            floor_level: floorName || room.floor_level || "",
            space_tag: room.space_tag || "",
            room_type: room.room_type || "general",
            area: room.area ?? null,
            area_unit: "sq ft",
            dimensions: room.dimensions || {},
            // Normalised [ymin, xmin, ymax, xmax] on 0-1000; powers the viewer overlays.
            bbox: Array.isArray(room.bbox) && room.bbox.length === 4 ? room.bbox : null,
            floor_finish: room.floor_finish || "",
            flooring_size: "",
            flooring_finish: room.flooring_finish || "",
            flooring_code: room.flooring_code || "",
            flooring_make: room.flooring_make || "",
            flooring_rate: room.flooring_rate || "",
            skirting: room.skirting || "",
            skirting_code: room.skirting_code || "",
            skirting_make: room.skirting_make || "",
            skirting_rate: room.skirting_rate || "",
            ceiling_finish: room.ceiling_finish || "",
            ceiling_material_2: room.ceiling_material_2 || "",
            ceiling_size: "",
            ceiling_code: room.ceiling_code || "",
            ceiling_make: room.ceiling_make || "",
            ceiling_rate: room.ceiling_rate || "",
            ceiling_height: room.ceiling_height ?? null,
            wall_finish: room.wall_finish || "",
            dado: room.dado || "",
            paint_color: room.paint_color || "",
            remark: room.remark || "Material recommendation based on room type and function.",
            notes: room.notes || "",
          }));

          const { error: roomError } = await supabase.from("rooms").insert(roomInserts);
          if (roomError) throw roomError;
        }

        // Structured detection metadata backs the "Not detected" summary.
        const analysisMeta = {
          label_count: analysisData.label_count ?? analysisData.label_inventory?.length ?? 0,
          undetected_spaces: analysisData.undetected_spaces ?? [],
          unmatched_labels: analysisData.unmatched_labels ?? [],
          sweep_complete: analysisData.sweep_complete ?? null,
          finish_reason: analysisData.finish_reason ?? null,
        };

        // Try to persist with analysis_meta; if that column doesn't exist yet
        // (migration not run), fall back so the upload still completes cleanly.
        const { error: metaError } = await supabase
          .from("drawings")
          .update({
            analysis_status: "completed",
            analysis_feedback: analysisData.analysis_feedback || "",
            analysis_meta: analysisMeta,
          })
          .eq("id", drawing.id);

        if (metaError) {
          console.warn("analysis_meta update failed, retrying without it:", metaError.message);
          await supabase
            .from("drawings")
            .update({
              analysis_status: "completed",
              analysis_feedback: analysisData.analysis_feedback || "",
            })
            .eq("id", drawing.id);
        }

        setProgress("Done!");
        return analysisData;
      } catch (err) {
        await supabase
          .from("drawings")
          .update({
            analysis_status: "failed",
            analysis_feedback: err instanceof Error ? err.message : "Analysis failed",
          })
          .eq("id", drawing.id);
        throw err;
      }
    },
    onSuccess: (data: AnalyzeDrawingResponse) => {
      queryClient.invalidateQueries({ queryKey: ["drawings", projectId] });
      queryClient.invalidateQueries({ queryKey: ["rooms", projectId] });

      const count = Array.isArray(data?.rooms) ? data.rooms.length : 0;
      const unmatched = data?.unmatched_labels?.length ?? 0;
      toast({
        title: `${count} room${count === 1 ? "" : "s"} detected on ${floorName}`,
        description: unmatched
          ? `${unmatched} label(s) need verification — see the analysis notes.`
          : "Review the schedule below.",
      });
      setUploading(false);
      setProgress("");
    },
    onError: (err: unknown) => {
      toast({ title: "Upload failed", description: errorMessage(err), variant: "destructive" });
      setUploading(false);
      setProgress("");
    },
  });

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) {
        uploadAndAnalyze.mutate(accepted[0]);
      }
    },
    [uploadAndAnalyze]
  );

  const disabled = uploading || !floorId;

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".webp", ".tiff", ".bmp"],
      "application/pdf": [".pdf"],
    },
    maxFiles: 1,
    disabled,
  });

  return (
    <div
      {...getRootProps()}
      className={`relative rounded-xl border-2 border-dashed p-8 text-center transition-all ${
        !floorId
          ? "cursor-not-allowed border-border bg-muted/30"
          : isDragActive
            ? "cursor-pointer border-primary bg-blueprint-light"
            : uploading
              ? "cursor-wait border-border bg-muted/50"
              : "cursor-pointer border-border hover:border-primary/50 hover:bg-blueprint-light/50"
      }`}
    >
      <input {...getInputProps()} />
      <AnimatePresence mode="wait">
        {!floorId ? (
          <motion.div
            key="no-floor"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center"
          >
            <Layers className="mb-2 h-7 w-7 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">Select a floor first</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Drawings are uploaded to a specific floor.
            </p>
          </motion.div>
        ) : uploading ? (
          <motion.div
            key="uploading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center"
          >
            <Loader2 className="mb-3 h-9 w-9 animate-spin text-primary" />
            <p className="text-sm font-medium text-foreground">{progress}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Detection sweeps the whole sheet — this can take up to a minute
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center"
          >
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-blueprint-light">
              <Upload className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm font-medium text-foreground">
              {isDragActive ? "Drop your drawing here" : `Upload drawing for ${floorName}`}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              PNG, JPG, WEBP or PDF • AI extracts every labelled room automatically
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
  });
}
