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
    applied_parent_name?: string;        // NEW — from override_parent_item_on_page
  }>;
  new_frames?: Array<{ id: FrameId; type: FrameType }>;
  removed_frame_ids?: FrameId[];
  new_page_ids?: string[];
  removed_page_ids?: string[];
  page_count?: number;
  // NEW
  changed_pages?: Array<{
    id: string;
    applied_parent_name?: string;
  }>;
  new_parent_spreads?: Array<{
    name: string;
    page_count: number;       // 1 (single) or 2 (facing)
  }>;
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
