export type FrameId = string;
export type StyleId = string;
export type DocumentId = string;

export interface DocumentStateDelta {
  changed_frames?: Array<{
    id: FrameId;
    bounds?: [number, number, number, number];
    applied_paragraph_style?: string;
  }>;
  new_frames?: Array<{ id: FrameId; type: string }>;
  removed_frame_ids?: FrameId[];
  new_page_ids?: string[];
  removed_page_ids?: string[];
  page_count?: number;
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
