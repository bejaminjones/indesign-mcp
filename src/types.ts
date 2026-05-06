export type FrameId = string;
export type StyleId = string;
export type DocumentId = string;

export type FrameType = "text" | "image" | "rectangle" | "line";

export interface DocumentStateDelta {
  changed_frames?: Array<{
    id: FrameId;
    bounds?: [number, number, number, number];
    applied_paragraph_style?: string;
    applied_image_path?: string;
    applied_parent_name?: string;        // from override_parent_item_on_page
    applied_character_style_range?: {    // from apply_character_style_to_range
      character_style_name: string;
      start_index: number;
      end_index: number;
    };
    inset_mm?: { top: number; left: number; bottom: number; right: number };  // from set_frame_inset
    columns?: { count: number; gutter_mm: number };                           // from set_frame_columns
    threaded_to_frame_id?: FrameId;                                           // from thread_text_frames
  }>;
  new_frames?: Array<{ id: FrameId; type: FrameType }>;
  removed_frame_ids?: FrameId[];
  new_page_ids?: string[];
  removed_page_ids?: string[];
  page_count?: number;
  changed_pages?: Array<{
    id: string;
    applied_parent_name?: string;
  }>;
  new_parent_spreads?: Array<{
    name: string;
    page_count: number;       // 1 (single) or 2 (facing)
  }>;
  new_character_styles?: Array<{ name: string }>;   // from define_character_style
}

export interface SuccessEnvelope<T> {
  ok: true;
  result?: T;
  document_state_delta?: DocumentStateDelta;
  warnings?: string[];
}

export interface FailureEnvelope {
  ok: false;
  error: ToolError;
}

export type Envelope<T = unknown> = SuccessEnvelope<T> | FailureEnvelope;

export interface ToolError {
  kind: ErrorKind;
  message: string;
  // Optional kind-specific fields
  stack?: string;
  entity?: string;
  id?: string;
}

export type ErrorKind =
  | "script_error"
  | "app_not_available"
  | "not_found"
  | "name_collision"
  | "io_error"
  | "timeout"
  | "invalid_args";
