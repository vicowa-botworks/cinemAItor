import { css, html, LitElement } from "lit";
import { ref } from "lit/directives/ref.js";
import { api } from "../api.js";
import {
  agentHistory,
  collectPendingTools,
  followUpMessage,
  needsProposalNudge,
} from "../copilot-followup.js";
import "./confirm-dialog.js";

const TASK_TYPES = [
  "text_to_image",
  "image_to_image",
  "image_to_video",
  "text_to_video",
  "audio",
  "music",
  "voice",
  "transcribe",
];

const BACKENDS = ["mock", "local_cli", "comfyui", "local_http"];

/** Task types the v1 benchmark can run without a source asset (must mirror
 * BENCHMARKABLE_TASKS in backend/src/services/model_benchmark.ts). */
const BENCHMARKABLE_TASKS = [
  "text_to_image",
  "text_to_video",
  "audio",
  "music",
  "voice",
];

const HF_FILTERS = [
  ["", "All"],
  ["text-to-image", "Text to image"],
  ["image-to-video", "Image to video"],
  ["text-to-video", "Text to video"],
  ["text-to-speech", "Text to speech"],
  ["text-to-audio", "Text to audio"],
  ["any-to-any", "Any to any"],
];

const EMPTY_HF_FORM = {
  name: "",
  version: "",
  backend: "local_cli",
  file: "",
  tasks: [],
  vram_requirement_mb: "",
  default_settings: "",
};

const SOURCES = ["local", "url", "mock"];

const EMPTY_REG_FORM = {
  name: "",
  version: "",
  backend: "mock",
  tasks: [],
  source: "",
  repository_url: "",
  source_path: "",
  license: "",
  vram_requirement_mb: "",
  ram_requirement_mb: "",
  dependencies: "",
  default_settings: "",
  enabled: true,
};

export class ModelManager extends LitElement {
  static styles = css`
    .model-manager {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .list-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .list-header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .list-title {
      font-size: 22px;
      font-weight: 600;
    }

    .btn {
      padding: 9px 18px;
      border: none;
      border-radius: var(--radius);
      font-size: 14px;
      cursor: pointer;
      font-weight: 500;
      background-color: var(--color-primary);
      color: white;
    }

    .btn:hover {
      background-color: var(--color-primary-hover);
    }

    .btn-secondary {
      background-color: var(--color-surface-hover);
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }

    .btn-danger {
      background-color: transparent;
      color: var(--color-error);
      border: 1px solid var(--color-error);
    }

    .btn-small {
      padding: 4px 10px;
      font-size: 12px;
      background-color: var(--color-surface-hover);
      color: var(--color-text);
      border: 1px solid var(--color-border);
    }

    .btn-small:hover {
      color: var(--color-primary);
      border-color: var(--color-primary);
    }

    .btn:disabled,
    .btn-small:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .panel {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 20px;
    }

    .panel h3 {
      margin: 0 0 12px;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-muted);
    }

    .hw-summary {
      font-size: 14px;
      display: flex;
      gap: 18px;
      flex-wrap: wrap;
    }

    .hw-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .hw-item span:first-child {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-text-muted);
    }

    .hw-warning {
      margin-top: 10px;
      font-size: 12px;
      color: #b45309;
    }

    .filters {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: flex-end;
    }

    .filter-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .filter-field label {
      font-size: 11px;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .filters input,
    .filters select {
      padding: 7px 10px;
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
      font-size: 13px;
    }

    .filters input {
      min-width: 200px;
    }

    .model-list {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .model-row {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .model-top {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .model-name {
      font-size: 16px;
      font-weight: 600;
    }

    .model-version {
      color: var(--color-text-muted);
      font-size: 13px;
    }

    .chip {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 999px;
      background-color: var(--color-surface-hover);
      color: var(--color-text-muted);
      border: 1px solid var(--color-border);
    }

    .chip.enabled {
      background-color: rgba(34, 197, 94, 0.15);
      color: #15803d;
      border-color: transparent;
    }

    .chip.disabled {
      opacity: 0.7;
    }

    .chip.health-ok {
      background-color: rgba(34, 197, 94, 0.15);
      color: #15803d;
      border-color: transparent;
    }

    .chip.health-error {
      background-color: rgba(239, 68, 68, 0.15);
      color: #b91c1c;
      border-color: transparent;
    }

    .chip.health-unknown {
      opacity: 0.7;
    }

    .model-meta {
      display: flex;
      gap: 18px;
      flex-wrap: wrap;
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .model-meta .tasks {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }

    .model-settings {
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: monospace;
    }

    .model-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }

    .error {
      color: var(--color-error);
      font-size: 13px;
    }

    .notice {
      font-size: 13px;
      padding: 8px 12px;
      border-radius: var(--radius);
    }

    .notice.ok {
      background-color: rgba(34, 197, 94, 0.12);
      color: #15803d;
    }

    .notice.err {
      background-color: rgba(239, 68, 68, 0.12);
      color: #b91c1c;
    }

    .empty {
      background-color: var(--color-surface);
      border: 1px dashed var(--color-border);
      border-radius: var(--radius);
      padding: 48px 24px;
      text-align: center;
      color: var(--color-text-muted);
      font-size: 14px;
    }

    .admin-note {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .bench-wrap {
      margin-top: 8px;
      font-size: 12px;
    }

    .bench-head {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--color-text-muted);
    }

    .bench-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
    }

    .bench-table th,
    .bench-table td {
      text-align: left;
      padding: 3px 10px 3px 0;
      border-bottom: 1px solid var(--color-border);
      white-space: nowrap;
    }

    .bench-table th {
      color: var(--color-text-muted);
      font-weight: 500;
    }

    .llm-head {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 4px;
    }

    .llm-head h3 {
      margin: 0;
    }

    .llm-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 12px;
      max-width: 640px;
    }

    .llm-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .llm-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .reg-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px 16px;
      margin-top: 12px;
    }

    .reg-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .llm-field.wide {
      grid-column: 1 / -1;
    }

    .llm-field label {
      font-size: 11px;
      color: var(--color-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .llm-field input[type="text"],
    .llm-field input[type="password"],
    .llm-field input[type="number"] {
      padding: 8px 10px;
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
      font-size: 13px;
    }

    .llm-check {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
    }

    .llm-check input {
      accent-color: var(--color-primary);
    }

    .copilot-chat {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 12px;
      max-height: 420px;
      overflow-y: auto;
      padding: 10px;
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
    }

    .copilot-empty {
      color: var(--color-text-muted);
      font-size: 13px;
      margin: 0;
    }

    .copilot-msg {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-width: 92%;
    }

    .copilot-msg.user {
      align-self: flex-end;
      align-items: flex-end;
    }

    .copilot-msg.assistant {
      align-self: flex-start;
    }

    .copilot-bubble {
      padding: 8px 12px;
      border-radius: var(--radius);
      font-size: 13px;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--color-text);
    }

    .copilot-msg.user .copilot-bubble {
      background-color: var(--color-primary);
      color: #fff;
    }

    .copilot-msg.assistant .copilot-bubble {
      background-color: var(--color-surface-hover);
      border: 1px solid var(--color-border);
    }

    .copilot-msg.user .copilot-bubble.synthetic {
      background-color: var(--color-surface);
      border: 1px dashed var(--color-border);
      color: var(--color-text-muted);
      font-size: 12px;
    }

    .copilot-auto-label {
      font-size: 10px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--color-text-muted);
      opacity: 0.7;
    }

    .copilot-nudge {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 6px;
      padding: 6px 10px;
      border: 1px dashed rgba(251, 191, 36, 0.5);
      border-radius: 8px;
      font-size: 12px;
      color: #fbbf24;
    }

    .copilot-steps {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .copilot-step {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .copilot-step .chip {
      font-size: 11px;
    }

    .copilot-step.ok .chip {
      background-color: rgba(74, 222, 128, 0.15);
      color: #4ade80;
    }

    .copilot-step.error .chip {
      background-color: rgba(248, 113, 113, 0.15);
      color: #f87171;
    }

    .copilot-step.proposal .chip {
      background-color: rgba(251, 191, 36, 0.15);
      color: #fbbf24;
    }

    .copilot-proposal {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      font-size: 12px;
    }

    .copilot-proposal .tool {
      font-weight: 600;
      color: var(--color-text);
    }

    .copilot-proposal .args {
      color: var(--color-text-muted);
      font-family: monospace;
      font-size: 11px;
      max-width: 420px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .copilot-proposal.done {
      opacity: 0.7;
    }

    .copilot-input {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }

    .copilot-input textarea {
      flex: 1;
      resize: vertical;
      min-height: 40px;
      max-height: 160px;
      padding: 8px 10px;
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      color: var(--color-text);
      font-size: 13px;
      font-family: inherit;
    }

    .copilot-history-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 420px;
      overflow-y: auto;
    }

    .copilot-history-item {
      display: flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 6px 10px;
    }

    .copilot-history-open {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
      background: none;
      border: none;
      color: var(--color-text);
      cursor: pointer;
      text-align: left;
      font: inherit;
      padding: 2px 0;
    }

    .copilot-history-open:hover .copilot-history-title {
      text-decoration: underline;
    }

    .copilot-history-title {
      font-weight: 600;
      font-size: 13px;
    }

    .copilot-history-sub {
      font-size: 11px;
      color: var(--color-text-muted);
    }

    .copilot-history-detail {
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-height: 480px;
      overflow-y: auto;
      padding: 4px 2px;
    }

    .copilot-history-detail-head {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--color-border);
    }

    .copilot-history-msg {
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      padding: 8px 10px;
    }

    .copilot-history-msg.user {
      background: var(--color-surface);
    }

    .copilot-history-msg.assistant {
      background: transparent;
    }

    .copilot-history-msg.event {
      display: flex;
      align-items: center;
      gap: 8px;
      background: transparent;
    }

    .copilot-history-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
      font-size: 12px;
    }

    .copilot-history-time {
      margin-left: auto;
      font-size: 11px;
      color: var(--color-text-muted);
    }

    .copilot-history-body {
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .copilot-history-steps {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 6px;
    }

    .reg-field label {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .reg-field label .req {
      color: var(--color-error);
    }

    .reg-field input,
    .reg-field select,
    .reg-field textarea {
      padding: 7px 10px;
      border: 1px solid var(--color-border);
      border-radius: var(--radius);
      background: var(--color-surface);
      color: var(--color-text);
      font-size: 13px;
      font-family: inherit;
      width: 100%;
      box-sizing: border-box;
    }

    .reg-field textarea {
      font-family: var(--font-mono, monospace);
      resize: vertical;
      min-height: 64px;
    }

    .reg-tasks {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      margin-top: 12px;
      align-items: center;
    }

    .reg-tasks .reg-tasks-label {
      font-size: 12px;
      color: var(--color-text-muted);
    }

    .reg-tasks label {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 13px;
      cursor: pointer;
    }

    .task-editor {
      margin: 10px 0 2px;
      padding: 10px 12px;
      border: 1px solid var(--color-border, rgba(128, 128, 128, 0.25));
      border-radius: 6px;
      background: rgba(128, 128, 128, 0.07);
    }

    .task-edit-btn {
      margin-left: 4px;
      padding: 1px 8px;
      font-size: 11px;
      color: var(--color-text-muted);
      background: transparent;
      border: 1px solid var(--color-border, rgba(128, 128, 128, 0.35));
      border-radius: 4px;
      cursor: pointer;
    }

    .task-editor-actions {
      margin-left: auto;
      display: inline-flex;
      gap: 8px;
    }

    .settings-editor-input {
      flex-basis: 100%;
      box-sizing: border-box;
      font-family: var(--font-mono, monospace);
      font-size: 12px;
      min-height: 96px;
      resize: vertical;
      padding: 8px;
      background: rgba(0, 0, 0, 0.25);
      color: inherit;
      border: 1px solid var(--color-border, rgba(128, 128, 128, 0.35));
      border-radius: 4px;
    }

    .btn-quiet {
      color: var(--color-text-muted);
      background: transparent;
    }

    .reg-advanced {
      margin-top: 14px;
      font-size: 13px;
    }

    .reg-advanced summary {
      cursor: pointer;
      color: var(--color-text-muted);
      font-weight: 500;
    }

    .reg-actions {
      display: flex;
      gap: 10px;
      margin-top: 16px;
    }

    .reg-actions .btn {
      padding: 8px 16px;
    }

    .btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .hf-search {
      display: flex;
      gap: 10px;
      margin: 12px 0;
      flex-wrap: wrap;
    }

    .hf-search input[type="search"] {
      flex: 1;
      min-width: 200px;
      padding: 8px 10px;
      background: var(--color-input-bg, #1e1e28);
      color: var(--color-text, #e5e5ef);
      border: 1px solid var(--color-border, #34344a);
      border-radius: 6px;
    }

    .hf-search select {
      padding: 8px 10px;
      background: var(--color-input-bg, #1e1e28);
      color: var(--color-text, #e5e5ef);
      border: 1px solid var(--color-border, #34344a);
      border-radius: 6px;
    }

    .hf-results {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 300px;
      overflow-y: auto;
      margin: 10px 0;
    }

    .hf-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border: 1px solid var(--color-border, #34344a);
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
    }

    .hf-row:hover {
      border-color: var(--color-accent, #7c6cf0);
    }

    .hf-row.active {
      border-color: var(--color-accent, #7c6cf0);
      background: rgba(124, 108, 240, 0.08);
    }

    .hf-row-id {
      font-weight: 500;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .hf-row-meta {
      color: var(--color-text-muted, #9a9ab0);
      font-size: 12px;
      white-space: nowrap;
    }

    .hf-repo {
      margin-top: 16px;
      border-top: 1px solid var(--color-border, #34344a);
      padding-top: 12px;
    }

    .hf-repo h4 {
      margin: 0 0 10px;
      font-size: 15px;
    }

    .hf-files {
      display: flex;
      flex-direction: column;
      gap: 2px;
      max-height: 220px;
      overflow-y: auto;
      margin-bottom: 12px;
      border: 1px solid var(--color-border, #34344a);
      border-radius: 6px;
      padding: 6px;
    }

    .hf-file {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 6px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }

    .hf-file.active {
      background: rgba(124, 108, 240, 0.12);
    }

    .hf-file-path {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: monospace;
    }

    .hf-file-size {
      color: var(--color-text-muted, #9a9ab0);
      font-size: 12px;
    }

    .hf-tasks {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 12px;
    }

    .hf-task {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      cursor: pointer;
    }

    .hf-settings-input {
      width: 100%;
      box-sizing: border-box;
      margin-top: 6px;
      font-family: monospace;
      font-size: 12px;
      resize: vertical;
      padding: 8px;
      background: rgba(0, 0, 0, 0.25);
      color: inherit;
      border: 1px solid rgba(128, 128, 128, 0.35);
      border-radius: 4px;
    }

    .hf-token {
      margin: 10px 0;
      padding: 8px 12px;
      border: 1px solid var(--border, #d0d0d0);
      border-radius: 8px;
    }

    .hf-token summary {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      cursor: pointer;
    }

    .hf-token-form {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
      align-items: center;
    }

    .hf-token-form input {
      flex: 1;
      min-width: 220px;
    }

    .hf-readme {
      margin-top: 8px;
    }

    .hf-readme pre {
      margin-top: 8px;
      max-height: 280px;
      overflow: auto;
      padding: 10px;
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      background: var(--code-bg, rgba(0, 0, 0, 0.04));
      border-radius: 6px;
    }
  `;

  // Live copilot conversation id (server-logged). A private field so the
  // _copilotConversationId() getter never resolves the method itself.
  #copilotConversationId = null;

  static properties = {
    models: { state: true },
    hardware: { state: true },
    hwWarnings: { state: true },
    isAdmin: { state: true },
    loading: { state: true },
    busyId: { state: true },
    error: { state: true },
    notice: { state: true },
    enabledFilter: { state: true },
    taskFilter: { state: true },
    query: { state: true },
    benchmarks: { state: true },
    benchBusyId: { state: true },
    taskEditorId: { state: true },
    taskDraft: { state: true },
    settingsEditorId: { state: true },
    settingsDraft: { state: true },
    llm: { state: true },
    llmConfigured: { state: true },
    llmDraft: { state: true },
    llmBusy: { state: true },
    llmNotice: { state: true },
    llmError: { state: true },
    copilot: { state: true },
    copilotInput: { state: true },
    copilotBusy: { state: true },
    copilotError: { state: true },
    copilotBusyProposals: { state: true },
    copilotBusySince: { state: true },
    copilotHistoryOpen: { state: true },
    copilotHistory: { state: true },
    copilotHistoryDetail: { state: true },
    copilotHistoryBusy: { state: true },
    copilotHistoryError: { state: true },
    showRegister: { state: true },
    regBusy: { state: true },
    regForm: { state: true },
    hfQuery: { state: true },
    hfFilter: { state: true },
    hfResults: { state: true },
    hfSearching: { state: true },
    hfError: { state: true },
    hfRepo: { state: true },
    hfLoadingRepo: { state: true },
    hfForm: { state: true },
    hfBusy: { state: true },
    hfNotice: { state: true },
    hfToken: { state: true },
    hfTokenInput: { state: true },
    hfTokenBusy: { state: true },
    hfTokenMsg: { state: true },
    confirmState: { state: true },
    confirmBusy: { state: true },
  };

  constructor() {
    super();
    this.models = [];
    this.hardware = null;
    this.hwWarnings = [];
    this.isAdmin = false;
    this.loading = false;
    this.busyId = null;
    this.error = "";
    this.notice = null;
    this.enabledFilter = "";
    this.taskFilter = "";
    this.query = "";
    this.benchmarks = {};
    this.benchBusyId = null;
    this.taskEditorId = null;
    this.taskDraft = [];
    this.settingsEditorId = null;
    this.settingsDraft = "";
    this.llm = null;
    this.llmConfigured = false;
    this.llmDraft = null;
    this.llmBusy = null;
    this.llmNotice = null;
    this.llmError = "";
    this.copilot = [];
    this.copilotInput = "";
    this.copilotBusy = false;
    this._copilotChatEl = null;
    this._copilotFollow = false;
    this.copilotError = "";
    this.copilotBusyProposals = [];
    this.copilotBusySince = {};
    this.copilotHistoryOpen = false;
    this.copilotHistory = [];
    this.copilotHistoryDetail = null;
    this.copilotHistoryBusy = false;
    this.copilotHistoryError = "";
    this.showRegister = false;
    this.regBusy = false;
    this.regForm = { ...EMPTY_REG_FORM };
    this.hfQuery = "";
    this.hfFilter = "";
    this.hfResults = null;
    this.hfSearching = false;
    this.hfError = "";
    this.hfRepo = null;
    this.hfLoadingRepo = false;
    this.hfForm = { ...EMPTY_HF_FORM };
    this.hfBusy = false;
    this.hfNotice = null;
    this.hfToken = null;
    this.hfTokenInput = "";
    this.hfTokenBusy = false;
    this.hfTokenMsg = null;
    this.confirmState = null;
    this.confirmBusy = false;
    this._queryTimer = null;
  }

  _setCopilotChatRef = (el) => {
    this._copilotChatEl = el;
    if (el && !el._copilotScrollWired) {
      el._copilotScrollWired = true;
      el.addEventListener("scroll", this._onCopilotChatScroll);
    }
  };

  disconnectedCallback() {
    super.disconnectedCallback?.();
    if (this._queryTimer) clearTimeout(this._queryTimer);
  }

  updated(changed) {
    if (
      changed.has("copilot") ||
      changed.has("copilotBusy") ||
      changed.has("copilotBusyProposals")
    ) {
      this._copilotAutoScroll();
    }
  }

  /**
   * Keep the copilot chat on the latest output: after any copilot update,
   * pin the scroll to the bottom if the user is following the current turn
   * (armed in _runCopilotTurn and sticky until they scroll up) or is
   * already near the bottom.
   */
  _copilotAutoScroll() {
    const el = this._copilotChatEl;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (this._copilotFollow || nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }

  /**
   * The user scrolled the chat up away from the bottom on their own — stop
   * following so new output doesn't yank them back down.
   */
  _onCopilotChatScroll = () => {
    const el = this._copilotChatEl;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight > 60) {
      this._copilotFollow = false;
    }
  };

  async connectedCallback() {
    super.connectedCallback?.();
    try {
      const me = await api.getMe();
      this.isAdmin = me?.role === "admin";
    } catch {
      this.isAdmin = false;
    }
    this._loadAll();
  }

  render() {
    return html`
      <div class="model-manager">
        <div class="list-header">
          <div class="list-title">Models</div>
          <div class="list-header-actions">
            ${this.isAdmin
              ? html`
                <button
                  class="btn"
                  @click=${() => (this.showRegister = !this.showRegister)}>
                  ${this.showRegister ? "Hide registration" : "Register model"}
                </button>
              `
              : null}
            <button class="btn btn-secondary" @click=${this._loadAll}>
              ${this.loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        ${this.isAdmin && this.showRegister ? this._renderRegisterForm() : null}

        ${this.error ? html`<div class="error">${this.error}</div>` : null}
        ${this.notice
          ? html`<div class="notice ${this.notice.kind}">${this.notice.text}</div>`
          : null}

        <div class="panel">
          <h3>Hardware</h3>
          ${this.hardware
            ? html`
              <div class="hw-summary">
                <div class="hw-item">
                  <span>Platform</span>
                  <span>${this.hardware.platform}/${this.hardware.arch}</span>
                </div>
                <div class="hw-item">
                  <span>CPU</span>
                  <span>${this.hardware.cpu_count} cores</span>
                </div>
                <div class="hw-item">
                  <span>RAM</span>
                  <span>${this._fmtMb(this.hardware.mem_total_mb)}</span>
                </div>
                <div class="hw-item">
                  <span>GPU</span>
                  <span>${this.hardware.gpu
                    ? `${this.hardware.gpu.model} (${this._fmtMb(this.hardware.gpu.vram_mb)})`
                    : "none detected"}</span>
                </div>
              </div>
              ${this.hwWarnings.map(
                (w) => html`<div class="hw-warning">⚠ ${w}</div>`,
              )}
            `
            : html`<div class="empty">No hardware report available.</div>`}
        </div>

        <div class="panel">
          <div class="llm-head">
            <h3>LLM Assistant</h3>
            <span class="chip ${this.llmConfigured ? "enabled" : "disabled"}">
              ${this.llmConfigured ? "configured" : "not configured"}
            </span>
          </div>
          <p class="admin-note">
            Point this at an OpenAI-compatible endpoint (llama.cpp server, Ollama
            <code>/v1</code>, LM Studio, ...). The endpoint powers the writing
            assistant and the Model Copilot.
          </p>
          ${this.isAdmin && this.llm
            ? html`
              <div class="llm-form">
                <label class="llm-check">
                  <input
                    type="checkbox"
                    .checked=${this.llmDraft.enabled}
                    @change=${(e) => this._llmSetField("enabled", e.target.checked)} />
                  Enable the LLM assistant
                </label>
                <div class="llm-grid">
                  <div class="llm-field wide">
                    <label for="llm-base-url">Base URL</label>
                    <input
                      id="llm-base-url"
                      type="text"
                      placeholder="http://localhost:8080/v1"
                      .value=${this.llmDraft.base_url}
                      @input=${(e) => this._llmSetField("base_url", e.target.value)} />
                  </div>
                  <div class="llm-field">
                    <label for="llm-model">Model</label>
                    <input
                      id="llm-model"
                      type="text"
                      placeholder="qwen3:8b"
                      .value=${this.llmDraft.model}
                      @input=${(e) => this._llmSetField("model", e.target.value)} />
                  </div>
                  <div class="llm-field">
                    <label for="llm-api-key">API key</label>
                    <input
                      id="llm-api-key"
                      type="password"
                      placeholder=${this.llm.apiKeySet
                        ? "set — leave empty to keep"
                        : "none (most local runners need no key)"}
                      .value=${this.llmDraft.api_key}
                      @input=${(e) => this._llmSetField("api_key", e.target.value)} />
                  </div>
                  <div class="llm-field">
                    <label for="llm-temperature">Temperature</label>
                    <input
                      id="llm-temperature"
                      type="text"
                      placeholder="0.7 (default)"
                      .value=${this.llmDraft.temperature}
                      @input=${(e) => this._llmSetField("temperature", e.target.value)} />
                  </div>
                  <div class="llm-field">
                    <label for="llm-max-tokens">Max tokens</label>
                    <input
                      id="llm-max-tokens"
                      type="text"
                      placeholder="server default"
                      .value=${this.llmDraft.max_tokens}
                      @input=${(e) => this._llmSetField("max_tokens", e.target.value)} />
                  </div>
                  <div class="llm-field">
                    <label for="llm-timeout">Timeout (s)</label>
                    <input
                      id="llm-timeout"
                      type="number"
                      min="1"
                      max="3600"
                      .value=${this.llmDraft.timeout_seconds}
                      @input=${(e) => this._llmSetField("timeout_seconds", e.target.value)} />
                  </div>
                </div>
                <div class="model-actions">
                  <button
                    class="btn-small"
                    ?disabled=${this.llmBusy !== null}
                    @click=${() => this._testLlm()}>
                    ${this.llmBusy === "test" ? "Testing..." : "Test connection"}
                  </button>
                  <button
                    class="btn-small"
                    ?disabled=${this.llmBusy !== null}
                    @click=${() => this._saveLlm()}>
                    ${this.llmBusy === "save" ? "Saving..." : "Save settings"}
                  </button>
                </div>
                ${this.llmNotice
                  ? html`<div class="notice ${this.llmNotice.kind}">${this.llmNotice.text}</div>`
                  : null}
                ${this.llmError ? html`<div class="error">${this.llmError}</div>` : null}
              </div>
            `
            : !this.isAdmin
            ? html`<p class="admin-note">Only admins can change the LLM settings.</p>`
            : null}
        </div>

        ${this._renderCopilotPanel()}

        ${this._renderHfPanel()}

        <div class="panel">
          <div class="filters">
            <div class="filter-field">
              <label for="filter-enabled">Enabled</label>
              <select
                id="filter-enabled"
                .value=${this.enabledFilter}
                @change=${(e) => {
                  this.enabledFilter = e.target.value;
                  this._loadModels();
                }}>
                <option value="">all</option>
                <option value="true">enabled</option>
                <option value="false">disabled</option>
              </select>
            </div>
            <div class="filter-field">
              <label for="filter-task">Task type</label>
              <select
                id="filter-task"
                .value=${this.taskFilter}
                @change=${(e) => {
                  this.taskFilter = e.target.value;
                  this._loadModels();
                }}>
                <option value="">all</option>
                ${TASK_TYPES.map(
                  (t) => html`<option value=${t}>${t}</option>`,
                )}
              </select>
            </div>
            <div class="filter-field" style="flex:1;">
              <label for="filter-query">Search</label>
              <input
                id="filter-query"
                type="text"
                placeholder="name or version..."
                .value=${this.query}
                @input=${this._onQueryInput} />
            </div>
          </div>
        </div>

        ${this.models.length === 0
          ? html`<div class="empty">
              ${this.loading ? "Loading models..." : "No models registered."}
            </div>`
          : html`
            <div class="model-list">
              ${this.models.map((m) => this._renderModel(m))}
            </div>
          `}

        ${!this.isAdmin
          ? html`
            <p class="admin-note">
              Install, enable/disable, and remove require the admin role.
              Health checks and verification are available to all users.
            </p>
          `
          : null}

        ${this.confirmState
          ? html`
            <confirm-dialog
              ?open=${true}
              title=${this._confirmSpec().title}
              message=${this._confirmSpec().message}
              confirmLabel=${this._confirmSpec().confirmLabel}
              cancelLabel="Cancel"
              tone=${this._confirmSpec().tone}
              ?busy=${this.confirmBusy}
              busyLabel=${this._confirmSpec().busyLabel}
              @confirm=${() => this._confirmAccept()}
              @cancel=${() => this._confirmDismiss()}
            ></confirm-dialog>
          `
          : null}
      </div>
    `;
  }

  _renderRegisterForm() {
    const f = this.regForm;
    const set = (key) => (e) => {
      const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      this.regForm = { ...this.regForm, [key]: value };
    };
    const toggleTask = (task) => () => {
      const tasks = f.tasks.includes(task) ? f.tasks.filter((t) => t !== task) : [...f.tasks, task];
      this.regForm = { ...this.regForm, tasks };
    };
    return html`
      <div class="panel">
        <h3>Register model</h3>
        <form @submit=${this._registerSubmit} @reset=${this._registerReset}>
          <div class="reg-grid">
            <div class="reg-field">
              <label for="reg-name">Name <span class="req">*</span></label>
              <input
                id="reg-name"
                type="text"
                required
                placeholder="e.g. SDXL Turbo"
                .value=${f.name}
                @input=${set("name")} />
            </div>
            <div class="reg-field">
              <label for="reg-version">Version <span class="req">*</span></label>
              <input
                id="reg-version"
                type="text"
                required
                placeholder="e.g. 1.0"
                .value=${f.version}
                @input=${set("version")} />
            </div>
            <div class="reg-field">
              <label for="reg-backend">Backend <span class="req">*</span></label>
              <select
                id="reg-backend"
                .value=${f.backend}
                @change=${set("backend")}>
                ${BACKENDS.map(
                  (b) => html`<option value=${b}>${b}</option>`,
                )}
              </select>
            </div>
            <div class="reg-field">
              <label for="reg-source">Source</label>
              <select
                id="reg-source"
                .value=${f.source}
                @change=${set("source")}>
                <option value="">—</option>
                ${SOURCES.map(
                  (s) => html`<option value=${s}>${s}</option>`,
                )}
              </select>
            </div>
            ${f.source === "url"
              ? html`
                <div class="reg-field">
                  <label for="reg-repo-url">Repository URL</label>
                  <input
                    id="reg-repo-url"
                    type="text"
                    placeholder="https://..."
                    .value=${f.repository_url}
                    @input=${set("repository_url")} />
                </div>
              `
              : null}
            ${f.source === "local"
              ? html`
                <div class="reg-field">
                  <label for="reg-source-path">Source path</label>
                  <input
                    id="reg-source-path"
                    type="text"
                    placeholder="/path/on/server"
                    .value=${f.source_path}
                    @input=${set("source_path")} />
                </div>
              `
              : null}
            <div class="reg-field">
              <label for="reg-license">License</label>
              <input
                id="reg-license"
                type="text"
                placeholder="e.g. Apache-2.0"
                .value=${f.license}
                @input=${set("license")} />
            </div>
            <div class="reg-field">
              <label for="reg-vram">VRAM requirement (MB)</label>
              <input
                id="reg-vram"
                type="number"
                min="0"
                placeholder="e.g. 8192"
                .value=${f.vram_requirement_mb}
                @input=${set("vram_requirement_mb")} />
            </div>
            <div class="reg-field">
              <label for="reg-ram">RAM requirement (MB)</label>
              <input
                id="reg-ram"
                type="number"
                min="0"
                placeholder="e.g. 16384"
                .value=${f.ram_requirement_mb}
                @input=${set("ram_requirement_mb")} />
            </div>
          </div>

          <div class="reg-tasks">
            <span class="reg-tasks-label">Task types:</span>
            ${TASK_TYPES.map(
              (t) =>
                html`
                  <label>
                    <input
                      type="checkbox"
                      .checked=${f.tasks.includes(t)}
                      @change=${toggleTask(t)} />
                    ${t}
                  </label>
                `,
            )}
          </div>

          <details class="reg-advanced">
            <summary>Advanced options</summary>
            <div class="reg-grid">
              <div class="reg-field">
                <label for="reg-deps">
                  Dependencies (comma-separated)
                </label>
                <input
                  id="reg-deps"
                  type="text"
                  placeholder="e.g. ffmpeg, python3"
                  .value=${f.dependencies}
                  @input=${set("dependencies")} />
              </div>
              <div class="reg-field">
                <label for="reg-settings">
                  Default settings (JSON)
                </label>
                <textarea
                  id="reg-settings"
                  placeholder='{"command": "/usr/local/bin/sdxl", "args": ["--prompt", "{prompt}", "--seed", "{seed}", "--out", "{output}"]}'
                  .value=${f.default_settings}
                  @input=${set("default_settings")}></textarea>
              </div>
              <div class="reg-field">
                <label>
                  <input
                    type="checkbox"
                    .checked=${f.enabled}
                    @change=${set("enabled")} />
                  Enabled on registration
                </label>
              </div>
            </div>
          </details>

          <div class="reg-actions">
            <button
              type="submit"
              class="btn"
              ?disabled=${this.regBusy}>
              ${this.regBusy ? "Registering..." : "Register"}
            </button>
            <button type="reset" class="btn btn-secondary">Clear</button>
          </div>
        </form>
      </div>
    `;
  }

  _renderCopilotPanel() {
    if (!this.llmConfigured) {
      return html`
        <div class="panel">
          <div class="llm-head">
            <h3>Model Copilot</h3>
            <span class="chip disabled">not configured</span>
          </div>
          <p class="admin-note">
            Configure the LLM assistant above to use the Model Copilot.
          </p>
        </div>
      `;
    }
    return html`
      <div class="panel">
        <div class="llm-head">
          <h3>${this.copilotHistoryOpen ? "Copilot history" : "Model Copilot"}</h3>
          <span class="chip enabled">tool harness</span>
          <button class="btn btn-secondary btn-small" @click=${() =>
            this.copilotHistoryOpen ? this._closeCopilotHistory() : this._openCopilotHistory()}>
            ${this.copilotHistoryOpen ? "Back to chat" : "History"}
          </button>
        </div>
        <p class="admin-note">
          Ask about models, registry state, or HuggingFace repos. Read-only tools
          run directly; mutating tools create a proposal that you must approve
          explicitly — except under a model's "Auto-approve" toggle, where its
          model-scoped tools (update, write file, install deps, smoke test,
          benchmark) run automatically so the copilot can drive a broken model
          to a working state end-to-end (register, install, remove always need
          your approval).
          ${!this.isAdmin ? "You are not an admin, so mutating tools are not available." : ""}
        </p>
        ${this.copilotHistoryOpen ? this._renderCopilotHistory() : html`
          ${this.copilot.length > 0
            ? html`
              <button class="btn btn-secondary btn-small" @click=${() => this._copilotClear()}>
                Clear conversation
              </button>
            `
            : null}
          ${this.copilot.length > 0
            ? html`
              <div
                class="copilot-chat"
                ref=${ref(this._setCopilotChatRef)}>
                ${this.copilot.map((turn) => this._renderCopilotTurn(turn))}
                ${this.copilotBusy
                  ? html`
                    <div class="copilot-msg assistant">
                      <div class="copilot-bubble">
                          Thinking...</div>
                    </div>
                  `
                  : null}
              </div>
            `
            : null}
          ${this.copilotError ? html`<div class="error">${this.copilotError}</div>` : null}
          <form
            class="copilot-input"
            @submit=${(e) => {
              e.preventDefault();
              this._sendCopilot();
            }}>
            <textarea
              placeholder="e.g. Which video models are installed and healthy? (Ctrl+Enter to send)"
              .value=${this.copilotInput}
              @input=${(e) => (this.copilotInput = e.target.value)}
              @keydown=${(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  this._sendCopilot();
                }
              }}></textarea>
            <button
              class="btn"
              type="submit"
              ?disabled=${this.copilotBusy || this.copilotInput.trim() === ""}>
              ${this.copilotBusy ? "Working..." : "Ask"}
            </button>
          </form>
        `}
      </div>
    `;
  }

  _renderCopilotTurn(turn) {
    const steps = (turn.steps ?? [])
      .filter((s) => s.status !== "proposal")
      .map(
        (s) =>
          html`
            <div class="copilot-step ${s.status}">
              <span class="chip">${s.status === "ok" ? s.tool : "error"}</span>
              <span>${s.summary}</span>
            </div>
          `,
      );
    const proposals = (turn.proposals ?? []).map((p) => this._renderProposal(p));
    // "Promise without a proposal": the reply asks the user to approve
    // something, but the turn created no proposals — there is nothing to
    // approve. Offer a nudge that sends the copilot back to create the
    // missing proposal (the backend prompt rule now forbids this, but a
    // dead-ended reply can still reach the UI).
    const nudge = turn.role === "assistant" &&
      !turn.synthetic &&
      (turn.proposals ?? []).length === 0 &&
      needsProposalNudge(turn.content);
    return html`
      <div class="copilot-msg ${turn.role}">
        ${turn.synthetic ? html`<div class="copilot-auto-label">auto-continue</div>` : null}
        ${turn.content
          ? html`<div class="copilot-bubble ${
            turn.synthetic ? "synthetic" : ""
          }">${turn.content}</div>`
          : null}
        ${steps.length > 0 ? html`<div class="copilot-steps">${steps}</div>` : null}
        ${proposals.length > 0 ? html`<div class="copilot-steps">${proposals}</div>` : null}
        ${nudge
          ? html`
            <div class="copilot-nudge">
              <span>This reply asks for approval but created no proposal.</span>
              <button
                class="btn btn-secondary btn-small"
                ?disabled=${this.copilotBusy}
                @click=${() => this._copilotNudge()}>
                Request the proposal
              </button>
            </div>
          `
          : null}
      </div>
    `;
  }

  _proposalArgsDisplay(args) {
    // Truncate long string values (e.g. a full runner script in a
    // write_model_file proposal) so the card stays readable.
    const display = {};
    for (const [key, value] of Object.entries(args)) {
      display[key] = typeof value === "string" && value.length > 240
        ? `${value.slice(0, 240)} … (${value.length} chars)`
        : value;
    }
    return JSON.stringify(display);
  }

  _renderProposal(p) {
    const isPending = p.status === "pending";
    // Busy = a local approve/reject call is in flight, or the server reports
    // the approved tool call is executing (survives reloads / re-syncs).
    const busy = this.copilotBusyProposals.includes(p.id) || p.in_flight === true;
    const since = this._proposalSinceLabel(p);
    const busyLabel = busy ? (since ? `Running… since ${since}` : "Running…") : "Approve";
    const argsDisplay = this._proposalArgsDisplay(p.args ?? {});
    return html`
      <div class="copilot-proposal ${isPending ? "" : "done"}">
        <span class="tool">${p.tool}</span>
        <span class="args" title=${argsDisplay}>
          ${argsDisplay}
        </span>
        ${isPending && this.isAdmin
          ? html`
            <button
              class="btn btn-small"
              ?disabled=${busy}
              @click=${() => this._copilotApprove(p)}>
                  ${busyLabel}
                </button>
            <button
              class="btn btn-secondary btn-small"
              ?disabled=${busy}
              @click=${() => this._copilotReject(p)}>
              Reject
            </button>
          `
          : html`<span class="chip">${p.status}${busy ? "..." : ""}</span>`}
        ${p.status === "approved" && p.result
          ? html`<span class="args">${this._copilotResultSummary(p.tool, p.result)}</span>`
          : null}
      </div>
    `;
  }

  _copilotResultSummary(tool, result) {
    if (tool === "register_model" || tool === "register_model_from_huggingface") {
      return `registered "${result.model?.name ?? "?"}"`;
    }
    if (tool === "install_model") return "install job enqueued";
    if (tool === "remove_model") return "model removed";
    if (tool === "update_model") {
      return `updated "${result.model?.name ?? result.model?.id ?? "?"}"`;
    }
    if (tool === "write_model_file") return `wrote ${result.path ?? "file"}`;
    if (tool === "install_model_deps") {
      return `venv ready (${(result.packages ?? []).length} package(s))`;
    }
    if (tool === "run_smoke_test") {
      const secs = typeof result.duration_ms === "number"
        ? `${(result.duration_ms / 1000).toFixed(1)}s`
        : "";
      if (result.status === "failed") {
        return `smoke test failed (exit ${result.exit_code ?? "?"} in ${secs})`;
      }
      if (result.status === "started_ok") {
        return `smoke test: started OK (ran the full ${secs} timeout)`;
      }
      return `smoke test passed in ${secs}`;
    }
    if (tool === "run_benchmark") {
      return `benchmark enqueued (job ${result.job_id ?? "?"}, ${
        (result.tasks ?? []).length
      } task(s))`;
    }
    return "";
  }

  _copilotHistory() {
    return agentHistory(this.copilot);
  }

  /**
   * Stable id for the live copilot conversation, created on the first turn.
   * A new id means "start a new conversation" server-side; a known id appends
   * to it. Reset by _copilotClear so "Clear conversation" starts fresh.
   */
  _copilotConversationId() {
    if (!this.#copilotConversationId) {
      this.#copilotConversationId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `conv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
    return this.#copilotConversationId;
  }

  async _sendCopilot() {
    const text = this.copilotInput.trim();
    if (!text || this.copilotBusy) return;
    this.copilotInput = "";
    await this._runCopilotTurn(text);
  }

  async _runCopilotTurn(text, { synthetic = false } = {}) {
    if (!text || this.copilotBusy) return;
    // A new turn is always user-triggered (send, or an approve/reject click
    // on a proposal) — follow its output to the bottom even if the user was
    // scrolled up. Follow is sticky: it must survive every render of the
    // in-flight reply, not just the first one.
    this._copilotFollow = true;
    this.copilotError = "";
    this.copilot = [
      ...this.copilot,
      { role: "user", content: text, synthetic },
      { role: "assistant", content: "", steps: [], proposals: [] },
    ];
    this.copilotBusy = true;
    try {
      const result = await api.llmAgent(
        this._copilotHistory(),
        undefined,
        this._copilotConversationId(),
      );
      this.copilot = [
        ...this.copilot.slice(0, -1),
        {
          role: "assistant",
          content: result.reply,
          steps: result.steps ?? [],
          proposals: result.proposals ?? [],
        },
      ];
    } catch (err) {
      // Drop the empty placeholder assistant turn and surface the error.
      this.copilot = [...this.copilot.slice(0, -2), { role: "user", content: text, synthetic }];
      this.copilotError = err.message || "The Model Copilot request failed.";
    } finally {
      this.copilotBusy = false;
    }
  }

  /**
   * Nudge for the "promise without a proposal" dead end: the last assistant
   * reply asked for approval but created no proposals, so there was nothing
   * to approve. Send a synthetic turn that points out the gap and demands
   * the mutating tool call (mirrors the backend prompt rule).
   */
  async _copilotNudge() {
    if (this.copilotBusy) return;
    await this._runCopilotTurn(
      "Your previous reply asked me to approve something, but it did not create any proposal, so there was nothing to approve. " +
        "Call the matching mutating tool now so the approval request exists — or state exactly what information is missing that prevents you from creating it.",
      { synthetic: true },
    );
  }

  /**
   * After a proposal resolves, send one follow-up turn so a multi-step plan
   * (runner script -> venv -> adapter update) continues without the user
   * having to type "continue". The message reports the outcome and which
   * steps are still pending, so the copilot proposes the next action (or
   * confirms the plan is complete).
   */
  async _copilotFollowUp(tool, verb, summary) {
    const pending = collectPendingTools(this.copilot);
    await this._runCopilotTurn(followUpMessage(tool, verb, summary, pending), {
      synthetic: true,
    });
  }

  _setProposal(proposal) {
    this.copilot = this.copilot.map((turn) => {
      if (!turn.proposals) return turn;
      return {
        ...turn,
        proposals: turn.proposals.map((p) => (p.id === proposal.id ? proposal : p)),
      };
    });
  }

  _markProposalBusy(id) {
    this.copilotBusyProposals = [...this.copilotBusyProposals, id];
    this.copilotBusySince = { ...this.copilotBusySince, [id]: new Date().toISOString() };
  }

  _clearProposalBusy(id) {
    if (!this.copilotBusyProposals.includes(id)) return;
    this.copilotBusyProposals = this.copilotBusyProposals.filter((x) => x !== id);
    const since = { ...this.copilotBusySince };
    delete since[id];
    this.copilotBusySince = since;
  }

  /** Local start time, falling back to the server's started_at. */
  _proposalSinceLabel(p) {
    const iso = this.copilotBusySince[p.id] || p.started_at;
    if (!iso) return "";
    const t = new Date(iso);
    return Number.isNaN(t.getTime()) ? "" : t.toLocaleTimeString();
  }

  /**
   * Re-sync proposal cards from the server after an approve/reject error: a
   * long-running approval may have completed (or still be executing) even
   * though this client's request failed or a duplicate landed. Returns the
   * error message to show (empty when the server state already settles it).
   */
  async _syncProposalError(id, err, fallback) {
    let list = null;
    try {
      list = (await api.llmListProposals()).proposals;
    } catch {
      list = null;
    }
    if (Array.isArray(list)) {
      for (const p of list) this._setProposal(p);
      const p = list.find((x) => x.id === id);
      if (p && (p.status !== "pending" || p.in_flight)) return "";
    }
    return err.message || fallback;
  }

  async _copilotApprove(proposal) {
    const id = proposal.id;
    this._markProposalBusy(id);
    this.copilotError = "";
    try {
      const { proposal: updated, result } = await api.llmApproveProposal(id);
      this._setProposal({ ...updated, result: result ?? updated.result });
      // Every mutating copilot tool changes the model registry (register /
      // install / remove) — refresh the list so the effect is visible without
      // a page reload.
      await this._loadModels();
      // Continue a multi-step plan: the copilot's turn ended when it created
      // the proposal, so the remaining steps need this follow-up turn.
      void this._copilotFollowUp(
        proposal.tool,
        "approved",
        this._copilotResultSummary(proposal.tool, result ?? updated.result),
      );
    } catch (err) {
      const message = await this._syncProposalError(id, err, "Approval failed.");
      this.copilotError = message;
      // Report the failure to the copilot so it can propose a corrected
      // replacement. _syncProposalError returns "" only when the server
      // state already settled the proposal (approved / still executing),
      // in which case there is no failure to report.
      if (message) void this._copilotFollowUp(proposal.tool, "failed", message);
    } finally {
      this._clearProposalBusy(id);
    }
  }

  async _copilotReject(proposal) {
    const id = proposal.id;
    this._markProposalBusy(id);
    this.copilotError = "";
    try {
      const { proposal: updated } = await api.llmRejectProposal(id);
      this._setProposal(updated);
      // Let the copilot adapt the plan (or confirm it is done) instead of
      // stranding the remaining steps.
      void this._copilotFollowUp(proposal.tool, "rejected");
    } catch (err) {
      this.copilotError = await this._syncProposalError(id, err, "Rejecting the proposal failed.");
    } finally {
      this._clearProposalBusy(id);
    }
  }

  _copilotClear() {
    this.copilot = [];
    this.copilotError = "";
    this.copilotBusyProposals = [];
    this.copilotBusySince = {};
    // A cleared conversation is a new one: the next turn mints a fresh id.
    this.#copilotConversationId = null;
    this._copilotFollow = false;
  }

  // --- Copilot conversation history (server-logged) ---

  async _openCopilotHistory() {
    this.copilotHistoryOpen = true;
    this.copilotHistoryError = "";
    this.copilotHistoryDetail = null;
    await this._loadCopilotHistory();
  }

  _closeCopilotHistory() {
    this.copilotHistoryOpen = false;
    this.copilotHistoryDetail = null;
    this.copilotHistoryError = "";
  }

  async _loadCopilotHistory() {
    this.copilotHistoryBusy = true;
    try {
      const res = await api.listLlmConversations();
      this.copilotHistory = res.conversations ?? [];
    } catch (err) {
      this.copilotHistoryError = err.message || "Failed to load copilot history.";
    } finally {
      this.copilotHistoryBusy = false;
    }
  }

  async _openCopilotConversation(id) {
    this.copilotHistoryError = "";
    this.copilotHistoryBusy = true;
    try {
      const res = await api.getLlmConversation(id);
      this.copilotHistoryDetail = res.conversation ?? null;
    } catch (err) {
      this.copilotHistoryError = err.message || "Failed to open this conversation.";
    } finally {
      this.copilotHistoryBusy = false;
    }
  }

  async _deleteCopilotConversation(id) {
    if (!window.confirm("Delete this conversation log? This cannot be undone.")) return;
    try {
      await api.deleteLlmConversation(id);
      if (this.copilotHistoryDetail?.id === id) this.copilotHistoryDetail = null;
      await this._loadCopilotHistory();
    } catch (err) {
      this.copilotHistoryError = err.message || "Failed to delete the conversation.";
    }
  }

  _renderCopilotHistoryMessage(msg) {
    const time = msg.created_at ? new Date(msg.created_at).toLocaleString() : "";
    if (msg.role === "event") {
      const label = msg.content === "approved" ? "Proposal approved" : "Proposal rejected";
      return html`
        <div class="copilot-history-msg event">
          <span class="chip">${label}</span>
          <span class="copilot-history-time">${time}</span>
        </div>
      `;
    }
    const isUser = msg.role === "user";
    return html`
      <div class="copilot-history-msg ${isUser ? "user" : "assistant"}">
        <div class="copilot-history-meta">
          <strong>${isUser ? (msg.synthetic ? "You (auto-continue)" : "You") : "Copilot"}</strong>
          <span class="copilot-history-time">${time}</span>
        </div>
        <div class="copilot-history-body">${msg.content}</div>
        ${!isUser && msg.steps?.length
          ? html`
            <div class="copilot-history-steps">
              ${msg.steps.map(
                (s) =>
                  html`<span class="chip">${s.tool ?? "?"}${
                    s.summary ? ` — ${s.summary}` : ""
                  }</span>`,
              )}
            </div>
          `
          : null}
      </div>
    `;
  }

  _renderCopilotHistory() {
    const detail = this.copilotHistoryDetail;
    return html`
      ${this.copilotHistoryError
        ? html`<div class="error">${this.copilotHistoryError}</div>`
        : null}
      ${detail
        ? html`
          <div class="copilot-history-detail">
            <div class="copilot-history-detail-head">
              <strong>${detail.title || "Untitled conversation"}</strong>
              <span class="chip">${detail.model ?? "unknown model"}</span>
              <span class="chip">${detail.messages.length} messages</span>
            </div>
            ${detail.messages.map((m) => this._renderCopilotHistoryMessage(m))}
          </div>
        `
        : html`
          ${this.copilotHistoryBusy && this.copilotHistory.length === 0
            ? html`<p class="admin-note">Loading…</p>`
            : null}
          ${this.copilotHistory.length === 0
            ? html`<p class="admin-note">No logged conversations yet.</p>`
            : html`
              <ul class="copilot-history-list">
                ${this.copilotHistory.map((c) => {
                  const updated = c.updated_at ? new Date(c.updated_at).toLocaleString() : "";
                  return html`
                    <li class="copilot-history-item">
                      <button
                        class="copilot-history-open"
                        @click=${() => this._openCopilotConversation(c.id)}>
                        <span class="copilot-history-title">${c.title || "Untitled"}</span>
                        <span class="copilot-history-sub">
                          ${c.message_count} messages · ${c.model ?? "?"} · ${updated}
                        </span>
                      </button>
                      <button
                        class="btn btn-danger btn-small"
                        @click=${() => this._deleteCopilotConversation(c.id)}>
                        Delete
                      </button>
                    </li>
                  `;
                })}
              </ul>
            `}
        `}
    `;
  }

  _renderHfPanel() {
    const form = this.hfForm;
    const setForm = (key) => (e) => {
      const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
      this.hfForm = { ...this.hfForm, [key]: value };
    };
    const toggleHfTask = (task) => () => {
      const tasks = form.tasks.includes(task)
        ? form.tasks.filter((t) => t !== task)
        : [...form.tasks, task];
      this.hfForm = { ...this.hfForm, tasks };
    };
    return html`
      <div class="panel">
        <div class="llm-head">
          <h3>Browse HuggingFace</h3>
          <span class="chip">catalog</span>
        </div>
        <p class="admin-note">
          Search the public HuggingFace model catalog, inspect a repo's files and
          register it straight into the registry. Registration only creates the
          model row — weights are downloaded later by the (consent-gated) install
          action.
        </p>
        ${this._renderHfTokenPanel()}
        <form
          class="hf-search"
          @submit=${(e) => {
            e.preventDefault();
            this._hfSearch();
          }}>
          <input
            type="search"
            placeholder="Search models, e.g. sdxl, wan, flux..."
            .value=${this.hfQuery}
            @input=${(e) => (this.hfQuery = e.target.value)} />
          <select
            .value=${this.hfFilter}
            @change=${(e) => (this.hfFilter = e.target.value)}>
            ${HF_FILTERS.map(
              ([value, label]) => html`<option value=${value}>${label}</option>`,
            )}
          </select>
          <button
            type="submit"
            class="btn"
            ?disabled=${this.hfSearching}>
            ${this.hfSearching ? "Searching..." : "Search"}
          </button>
        </form>
        ${this.hfError ? html`<div class="error">${this.hfError}</div>` : null}
        ${this.hfNotice
          ? html`<div class="notice ${this.hfNotice.kind}">${this.hfNotice.text}</div>`
          : null}

        ${this.hfResults
          ? html`
            <div class="hf-results">
              ${this.hfResults.map(
                (r) =>
                  html`
                    <div
                      class="hf-row ${this.hfRepo?.repo.id === r.id ? "active" : ""}"
                      @click=${() => this._hfSelectRepo(r.id)}>
                      <span class="hf-row-id">${r.id}</span>
                      ${r.pipeline_tag ? html`<span class="chip">${r.pipeline_tag}</span>` : null}
                      <span class="hf-row-meta">
                        ♥ ${r.likes} · ↓ ${r.downloads.toLocaleString()}
                        ${r.license ? html`· ${r.license}` : ""}
                      </span>
                    </div>
                  `,
              )}
            </div>
          `
          : null}

        ${this.hfLoadingRepo ? html`<div class="empty">Loading repo...</div>` : null}
        ${this.hfRepo
          ? html`
            <div class="hf-repo">
              <h4>${this.hfRepo.repo.id}</h4>
              ${(this.hfRepo.repo.tags ?? [])
                .filter((t) => !t.startsWith("license:"))
                .slice(0, 6)
                .map((t) => html`<span class="chip">${t}</span>`)}
              ${this.hfRepo.readme
                ? html`
                  <details class="hf-readme">
                    <summary>README (usage examples)</summary>
                    <pre>${this.hfRepo.readme}</pre>
                  </details>
                `
                : null}
              <div class="hf-files">
                ${this.hfRepo.files.map(
                  (f) =>
                    html`
                      <label class="hf-file ${form.file === f.path ? "active" : ""}">
                        <input
                          type="radio"
                          name="hf-file"
                          value=${f.path}
                          .checked=${form.file === f.path}
                          @change=${() => {
                            this.hfForm = { ...this.hfForm, file: f.path };
                          }} />
                        <span class="hf-file-path">${f.path}</span>
                        <span class="hf-file-size">${this._fmtBytes(f.size)}</span>
                      </label>
                    `,
                )}
              </div>
              ${this.hfRepo.filesTruncated
                ? html`<div class="notice">
                  File listing is capped — weight files are always kept.
                </div>`
                : null}
              <div class="reg-grid">
                <div class="reg-field">
                  <label for="hf-name">Name</label>
                  <input
                    id="hf-name"
                    type="text"
                    placeholder=${this.hfRepo.repo.id}
                    .value=${form.name}
                    @input=${setForm("name")} />
                </div>
                <div class="reg-field">
                  <label for="hf-version">Version</label>
                  <input
                    id="hf-version"
                    type="text"
                    placeholder="1.0"
                    .value=${form.version}
                    @input=${setForm("version")} />
                </div>
                <div class="reg-field">
                  <label for="hf-backend">Backend</label>
                  <select
                    id="hf-backend"
                    .value=${form.backend}
                    @change=${setForm("backend")}>
                    ${BACKENDS.map(
                      (b) => html`<option value=${b}>${b}</option>`,
                    )}
                  </select>
                </div>
                <div class="reg-field">
                  <label for="hf-vram">Min VRAM (MB)</label>
                  <input
                    id="hf-vram"
                    type="number"
                    min="0"
                    placeholder="optional"
                    .value=${form.vram_requirement_mb}
                    @input=${setForm("vram_requirement_mb")} />
                </div>
              </div>
              ${form.backend === "local_cli" || form.backend === "comfyui"
                ? html`
                  <div class="reg-field">
                    <label for="hf-settings">
                      default_settings (JSON, required for ${form.backend})
                    </label>
                    <textarea
                      id="hf-settings"
                      class="hf-settings-input"
                      rows="3"
                      spellcheck="false"
                      placeholder=${form.backend === "local_cli"
                        ? '{"command": "/path/to/runner", "args": ["--prompt", "{prompt}", "--out", "{output}"]}'
                        : '{"endpoint": "http://127.0.0.1:8188", "workflow": { ... }}'}
                      .value=${form.default_settings}
                      @input=${setForm("default_settings")}></textarea>
                  </div>
                `
                : null}
              <div class="hf-tasks">
                ${TASK_TYPES.map(
                  (t) =>
                    html`
                      <label class="hf-task">
                        <input
                          type="checkbox"
                          .checked=${form.tasks.includes(t)}
                          @change=${toggleHfTask(t)} />
                        ${t}
                      </label>
                    `,
                )}
              </div>
              <div class="reg-actions">
                ${this.isAdmin
                  ? html`
                    <button
                      class="btn"
                      ?disabled=${this.hfBusy || !form.file}
                      @click=${this._hfRegister}>
                      ${this.hfBusy ? "Registering..." : "Register model"}
                    </button>
                  `
                  : html`
                    <span class="admin-note" title="Only admins can register models">
                      Register is admin-only
                    </span>
                  `}
                <button
                  class="btn btn-secondary"
                  ?disabled=${this.hfBusy}
                  @click=${() => this._hfAskCopilot()}>
                  Ask Model Copilot
                </button>
              </div>
            </div>
          `
          : null}
      </div>
    `;
  }

  async _hfSearch() {
    this.hfSearching = true;
    this.hfError = "";
    this.hfNotice = null;
    try {
      const res = await api.searchHuggingFace({
        q: this.hfQuery.trim(),
        filter: this.hfFilter,
        limit: 12,
      });
      this.hfResults = res.results ?? [];
      this.hfRepo = null;
      if (this.hfResults.length === 0) {
        this.hfNotice = { kind: "ok", text: "No repos matched." };
      }
    } catch (err) {
      this.hfError = err?.message ?? "HuggingFace search failed";
    } finally {
      this.hfSearching = false;
    }
  }

  async _hfSelectRepo(repoId) {
    if (this.hfRepo?.repo.id === repoId) return;
    this.hfLoadingRepo = true;
    this.hfError = "";
    this.hfNotice = null;
    try {
      const res = await api.getHuggingFaceRepo(repoId);
      this.hfRepo = res;
      const weight = res.files.find((f) => /\.(safetensors|gguf|ckpt|bin)$/i.test(f.path));
      const tag = (res.repo.pipeline_tag ?? "").replace(/-/g, "_");
      this.hfForm = {
        ...EMPTY_HF_FORM,
        file: weight ? weight.path : "",
        name: res.repo.id,
        tasks: TASK_TYPES.includes(tag) ? [tag] : [],
      };
    } catch (err) {
      this.hfError = err?.message ?? "Could not load the repo";
    } finally {
      this.hfLoadingRepo = false;
    }
  }

  _hfAskCopilot() {
    const repo = this.hfRepo;
    if (!repo) return;
    const lines = [`Help me register this HuggingFace repo: ${repo.repo.id}`];
    if (repo.repo.pipeline_tag) lines.push(`Pipeline: ${repo.repo.pipeline_tag}`);
    lines.push(`Weight file: ${this.hfForm.file || "auto (largest weight file)"}`);
    lines.push(`Backend: ${this.hfForm.backend}`);
    if (this.hfForm.default_settings.trim()) {
      lines.push(`default_settings: ${this.hfForm.default_settings.trim()}`);
    }
    if (repo.readme) lines.push(`README excerpt: ${repo.readme.slice(0, 600)}`);
    this.copilotInput = lines.join("\n");
    this.updateComplete.then(() => {
      this.shadowRoot?.querySelector(".copilot-input textarea")?.focus();
    });
  }

  _renderHfTokenPanel() {
    if (!this.isAdmin) return null;
    const status = this.hfToken ?? { tokenSet: false, tokenSource: "none" };
    const hasToken = status.tokenSet || status.tokenSource === "env";
    const source = status.tokenSource === "settings"
      ? "stored token"
      : status.tokenSource === "env"
      ? "HF_TOKEN env"
      : "not set";
    return html`
      <details class="hf-token">
        <summary>
          HuggingFace token
          <span class="chip ${hasToken ? "enabled" : "disabled"}">${source}</span>
        </summary>
        <p class="admin-note">
          Optional. Forwarded to HuggingFace as a Bearer credential — needed when a
          repo (or its API) restricts anonymous access. A stored token takes
          precedence over the HF_TOKEN env variable.
        </p>
        <form
          class="hf-token-form"
          @submit=${(e) => {
            e.preventDefault();
            this._hfTokenSave();
          }}>
          <input
            type="password"
            placeholder="hf_..."
            autocomplete="new-password"
            .value=${this.hfTokenInput}
            @input=${(e) => (this.hfTokenInput = e.target.value)} />
          <button
            class="btn btn-small"
            type="submit"
            ?disabled=${this.hfTokenBusy || this.hfTokenInput === ""}>
            ${this.hfTokenBusy ? "Saving..." : "Save token"}
          </button>
          <button
            class="btn btn-secondary btn-small"
            type="button"
            ?disabled=${this.hfTokenBusy || !status.tokenSet}
            @click=${() => this._hfTokenClear()}>
            Clear
          </button>
          <button
            class="btn btn-secondary btn-small"
            type="button"
            ?disabled=${this.hfTokenBusy || !hasToken}
            @click=${() => this._hfTokenTest()}>
            Test
          </button>
        </form>
        ${this.hfTokenMsg
          ? html`<div class="notice ${this.hfTokenMsg.kind}">${this.hfTokenMsg.text}</div>`
          : null}
      </details>
    `;
  }

  async _hfTokenSave() {
    this.hfTokenBusy = true;
    this.hfTokenMsg = null;
    try {
      this.hfToken = await api.updateHuggingFaceToken(this.hfTokenInput.trim());
      this.hfTokenInput = "";
      this.hfTokenMsg = { kind: "ok", text: "Token saved." };
    } catch (err) {
      this.hfTokenMsg = { kind: "error", text: err?.message ?? "Failed to save the token" };
    } finally {
      this.hfTokenBusy = false;
    }
  }

  async _hfTokenClear() {
    this.hfTokenBusy = true;
    this.hfTokenMsg = null;
    try {
      this.hfToken = await api.updateHuggingFaceToken(null);
      this.hfTokenMsg = { kind: "ok", text: "Stored token cleared." };
    } catch (err) {
      this.hfTokenMsg = { kind: "error", text: err?.message ?? "Failed to clear the token" };
    } finally {
      this.hfTokenBusy = false;
    }
  }

  async _hfTokenTest() {
    this.hfTokenBusy = true;
    this.hfTokenMsg = null;
    try {
      const res = await api.testHuggingFaceToken();
      this.hfToken = await api.getHuggingFaceSettings();
      this.hfTokenMsg = {
        kind: "ok",
        text: `Token accepted — authenticated as ${res.name}.`,
      };
    } catch (err) {
      this.hfTokenMsg = { kind: "error", text: err?.message ?? "Token test failed" };
    } finally {
      this.hfTokenBusy = false;
    }
  }

  async _hfRegister() {
    const form = this.hfForm;
    if (!this.hfRepo || !form.file) return;
    this.hfBusy = true;
    this.hfError = "";
    this.hfNotice = null;
    const payload = {
      repo_id: this.hfRepo.repo.id,
      file: form.file,
      backend: form.backend,
    };
    if (form.name.trim()) payload.name = form.name.trim();
    if (form.version.trim()) payload.version = form.version.trim();
    if (form.tasks.length > 0) payload.task_types = form.tasks;
    if (form.vram_requirement_mb !== "") {
      payload.min_vram_mb = Number(form.vram_requirement_mb);
    }
    if (form.default_settings.trim()) {
      try {
        const parsed = JSON.parse(form.default_settings);
        if (
          typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
        ) {
          throw new Error("must be a JSON object");
        }
        payload.default_settings = parsed;
      } catch (err) {
        this.hfError = `default_settings is not valid JSON: ${err.message}`;
        this.hfBusy = false;
        return;
      }
    }
    try {
      const res = await api.registerModelFromHuggingFace(payload);
      this.hfNotice = {
        kind: "ok",
        text: `Registered "${res.model.name}" (id: ${res.model.id}, file: ${res.file}). ` +
          "Use its Install action to download the weights.",
      };
      await this._loadAll();
    } catch (err) {
      this.hfError = err?.message ?? "Registration failed";
    } finally {
      this.hfBusy = false;
    }
  }

  _renderModel(m) {
    const busy = this.busyId === m.id;
    const needsConsent = m.repository_url &&
      (m.source === "url" || m.source === null || m.source === undefined);
    return html`
      <div class="model-row">
        <div class="model-top">
          <span class="model-name">${m.name}</span>
          ${m.version ? html`<span class="model-version">${m.version}</span>` : null}
          <span class="chip">${m.backend}</span>
          <span class="chip ${m.enabled ? "enabled" : "disabled"}">
            ${m.enabled ? "enabled" : "disabled"}
          </span>
          <span
            class="chip ${this._healthClass(m)}"
            title=${m.health_error ?? ""}>${this._healthLabel(m)}</span>
          ${m.installed_at
            ? html`<span class="chip">installed</span>`
            : html`<span class="chip health-unknown">not installed</span>`}
        </div>

        <div class="model-meta">
          <div class="tasks">
            <span>Tasks:</span>
            ${m.task_types.length > 0
              ? m.task_types.map((t) => html`<span class="chip">${t}</span>`)
              : html`<span>—</span>`}
            ${this.isAdmin
              ? html`
                <button
                  class="btn-small task-edit-btn"
                  ?disabled=${busy || this.busyId === m.id}
                  title="Edit task types"
                  @click=${() => this._openTaskEditor(m)}>
                  ${this.taskEditorId === m.id ? "Close" : "Edit tasks"}
                </button>
                <button
                  class="btn-small task-edit-btn"
                  ?disabled=${busy || this.busyId === m.id}
                  title="Edit default_settings (JSON)"
                  @click=${() => this._openSettingsEditor(m)}>
                  ${this.settingsEditorId === m.id ? "Close" : "Settings"}
                </button>
              `
              : null}
          </div>
          ${this.taskEditorId === m.id ? this._renderTaskEditor(m) : null}
          ${this.settingsEditorId === m.id ? this._renderSettingsEditor(m) : null}
          ${m.vram_requirement_mb !== null
            ? html`<span>VRAM ≥ ${this._fmtMb(m.vram_requirement_mb)}</span>`
            : null}
          ${m.ram_requirement_mb !== null
            ? html`<span>RAM ≥ ${this._fmtMb(m.ram_requirement_mb)}</span>`
            : null}
          ${m.source ? html`<span>source: ${m.source}</span>` : null}
          ${this._renderSettings(m)}
        </div>

        ${m.health_error ? html`<div class="error">${m.health_error}</div>` : null}
        ${m.health_checked_at
          ? html`
            <div class="model-meta">
              <span>
                last health check:
                ${new Date(m.health_checked_at).toLocaleString()}
              </span>
            </div>
          `
          : null}

        ${this._renderBenchmarks(m)}

        <div class="model-actions">
          <button
            class="btn-small"
            ?disabled=${busy}
            @click=${() =>
              this._run(
                m.id,
                (id) => api.healthCheckModel(id),
                (res) =>
                  res.status === "ok"
                    ? `"${m.name}": health OK — ${res.message}`
                    : `"${m.name}": ${res.message}`,
              )}>
            ${busy ? "Checking…" : "Health check"}
          </button>
          <button
            class="btn-small"
            ?disabled=${busy}
            @click=${() =>
              this._run(
                m.id,
                (id) => api.verifyModel(id),
                (res) =>
                  res.valid
                    ? `"${m.name}": ${res.message}`
                    : `"${m.name}": verification failed — ${res.message}`,
              )}>
            ${busy ? "Verifying…" : "Verify checksum"}
          </button>
          <button
            class="btn-small"
            ?disabled=${this.busyId === m.id ||
              this.benchBusyId === m.id ||
              !m.installed_at ||
              !m.enabled ||
              this._benchmarkableTasks(m).length === 0}
            title=${!m.installed_at
              ? "Install the model first"
              : !m.enabled
              ? "Enable the model first"
              : this._benchmarkableTasks(m).length === 0
              ? `No benchmarkable task types (benchmarkable: ${
                BENCHMARKABLE_TASKS.join(", ")
              }; model supports: ${m.task_types.join(", ") || "none"}). Edit tasks to add one.`
              : "Run a deterministic benchmark job for each input-less task type"}
            @click=${() => this._runBenchmark(m)}>
            ${this.benchBusyId === m.id ? "Benchmarking..." : "Benchmark"}
          </button>
          ${this.isAdmin
            ? html`
              <button
                class="btn-small"
                ?disabled=${busy}
                @click=${() => this._setEnabled(m, !m.enabled)}>
                ${m.enabled ? "Disable" : "Enable"}
              </button>
              <button
                class="btn-small"
                ?disabled=${busy}
                @click=${() => this._install(m, needsConsent)}>
                Install
              </button>
              <button
                class="btn-small btn-danger"
                ?disabled=${busy}
                @click=${() => this._remove(m)}>
                Remove
              </button>
              <button
                class="btn-small"
                ?disabled=${busy}
                ?auto=${m.agent_auto_approve}
                title="Auto-approve the copilot's model-scoped tools for this model (update, write file, install deps, smoke test, benchmark) so it can run a fix loop end-to-end. Register/install/remove always need manual approval."
                @click=${() => this._setAutoApprove(m, !m.agent_auto_approve)}>
                ${m.agent_auto_approve ? "Auto-approve: on" : "Auto-approve: off"}
              </button>
            `
            : null}
        </div>
      </div>
    `;
  }

  _renderSettings(m) {
    const s = m.default_settings;
    if (!s || typeof s !== "object" || Object.keys(s).length === 0) return html``;
    const label = typeof s.command === "string" && s.command
      ? `cmd: ${s.command}`
      : typeof s.endpoint === "string" && s.endpoint
      ? `endpoint: ${s.endpoint}`
      : null;
    return label
      ? html`<span class="model-settings" title=${JSON.stringify(s)}>${label}</span>`
      : html``;
  }

  _renderTaskEditor(m) {
    const draft = this.taskDraft;
    return html`
      <div class="reg-tasks task-editor">
        <span class="reg-tasks-label">Task types:</span>
        ${TASK_TYPES.map(
          (t) =>
            html`
              <label>
                <input
                  type="checkbox"
                  .checked=${draft.includes(t)}
                  @change=${() => this._toggleTaskDraft(t)} />
                ${t}
              </label>
            `,
        )}
        <span class="task-editor-actions">
          <button
            class="btn-small"
            ?disabled=${this.busyId === m.id}
            @click=${() => this._saveTaskTypes(m)}>
            ${this.busyId === m.id ? "Saving…" : "Save tasks"}
          </button>
          <button class="btn-small btn-quiet" @click=${() => this._closeTaskEditor()}>
            Cancel
          </button>
        </span>
      </div>
    `;
  }

  _renderSettingsEditor(m) {
    const hint = m.backend === "local_cli"
      ? 'local_cli: {"command": "/path/to/runner", "args": ["--prompt", "{prompt}", "--seed", "{seed}", "--out", "{output}"], "timeout_seconds": 600} — placeholders: {prompt} {seed} {candidate} {count} {output} {input:<i>}'
      : m.backend === "comfyui"
      ? 'comfyui: {"endpoint": "http://127.0.0.1:8188", "workflow": {…ComfyUI prompt graph…}} — string placeholders: {{prompt}} {{seed}} {{input:<i>}}'
      : "Free-form JSON object merged into the model's default settings.";
    return html`
      <div class="task-editor">
        <span class="reg-tasks-label">default_settings (JSON):</span>
        <textarea
          class="settings-editor-input"
          spellcheck="false"
          .value=${this.settingsDraft}
          @input=${(e) => (this.settingsDraft = e.target.value)}></textarea>
        <span class="reg-tasks-label">${hint}</span>
        <span class="task-editor-actions">
          <button
            class="btn-small"
            ?disabled=${this.busyId === m.id}
            @click=${() => this._saveSettings(m)}>
            ${this.busyId === m.id ? "Saving…" : "Save settings"}
          </button>
          <button class="btn-small btn-quiet" @click=${() => this._closeSettingsEditor()}>
            Cancel
          </button>
        </span>
      </div>
    `;
  }

  _openTaskEditor(m) {
    if (this.taskEditorId === m.id) {
      this._closeTaskEditor();
      return;
    }
    this._closeSettingsEditor();
    this.taskEditorId = m.id;
    this.taskDraft = [...(m.task_types || [])];
  }

  _closeTaskEditor() {
    this.taskEditorId = null;
    this.taskDraft = [];
  }

  _openSettingsEditor(m) {
    if (this.settingsEditorId === m.id) {
      this._closeSettingsEditor();
      return;
    }
    this._closeTaskEditor();
    this.settingsEditorId = m.id;
    this.settingsDraft = JSON.stringify(
      m.default_settings && Object.keys(m.default_settings).length > 0 ? m.default_settings : {},
      null,
      2,
    );
  }

  _closeSettingsEditor() {
    this.settingsEditorId = null;
    this.settingsDraft = "";
  }

  async _saveSettings(m) {
    let settings;
    try {
      const parsed = JSON.parse(this.settingsDraft || "{}");
      if (
        typeof parsed !== "object" || parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error("must be a JSON object");
      }
      settings = parsed;
    } catch (err) {
      this.error = `Default settings is not valid JSON: ${err.message}`;
      return;
    }
    this.busyId = m.id;
    this.error = "";
    try {
      await api.updateModel(m.id, { default_settings: settings });
      this._closeSettingsEditor();
      this.notice = {
        kind: "ok",
        text: `"${m.name}" settings updated.`,
      };
      await this._loadModels();
    } catch (err) {
      this.error = err.message || "Failed to update settings.";
    } finally {
      this.busyId = null;
    }
  }

  _toggleTaskDraft(t) {
    const set = new Set(this.taskDraft);
    if (set.has(t)) set.delete(t);
    else set.add(t);
    this.taskDraft = TASK_TYPES.filter((x) => set.has(x));
  }

  async _saveTaskTypes(m) {
    this.busyId = m.id;
    this.error = "";
    try {
      await api.updateModel(m.id, { task_types: this.taskDraft });
      this._closeTaskEditor();
      this.notice = {
        kind: "ok",
        text: `"${m.name}" task types updated.`,
      };
      await this._loadModels();
    } catch (err) {
      this.error = err.message || "Failed to update task types.";
    } finally {
      this.busyId = null;
    }
  }

  _onQueryInput(e) {
    this.query = e.target.value;
    if (this._queryTimer) clearTimeout(this._queryTimer);
    this._queryTimer = setTimeout(() => this._loadModels(), 300);
  }

  async _loadAll() {
    this.loading = true;
    this.error = "";
    this.notice = null;
    try {
      await this._loadModels();
      await this._loadHardware();
      await this._loadBenchmarks();
      await this._loadLlm();
      await this._loadHfToken();
    } finally {
      this.loading = false;
    }
  }

  async _loadHfToken() {
    if (!this.isAdmin) {
      this.hfToken = null;
      return;
    }
    try {
      this.hfToken = await api.getHuggingFaceSettings();
    } catch {
      this.hfToken = null;
    }
  }

  async _loadBenchmarks() {
    if (this.models.length === 0) {
      this.benchmarks = {};
      return;
    }
    const settled = await Promise.all(
      this.models.map(async (m) => {
        try {
          const { benchmarks } = await api.getModelBenchmarks(m.id);
          return [m.id, benchmarks];
        } catch {
          return [m.id, []];
        }
      }),
    );
    this.benchmarks = Object.fromEntries(settled);
  }

  async _loadModels() {
    try {
      this.models = await api.listModels({
        enabled: this.enabledFilter,
        task_type: this.taskFilter,
        query: this.query,
      });
      this.error = "";
    } catch (err) {
      this.error = err.message || "Failed to load models.";
    }
  }

  async _loadHardware() {
    try {
      const result = await api.getModelsHardware();
      this.hardware = result.hardware;
      this.hwWarnings = result.warnings ?? [];
    } catch {
      this.hardware = null;
      this.hwWarnings = [];
    }
  }

  async _loadLlm() {
    try {
      if (this.isAdmin) {
        this.llm = await api.getLlmSettings();
        this.llmConfigured = this.llm.configured;
        this.llmDraft = {
          enabled: this.llm.enabled,
          base_url: this.llm.baseUrl,
          api_key: "",
          model: this.llm.model,
          temperature: this.llm.temperature,
          max_tokens: this.llm.maxTokens,
          timeout_seconds: this.llm.timeoutSeconds,
        };
      } else {
        const status = await api.getLlmStatus();
        this.llmConfigured = status.configured;
      }
    } catch {
      this.llm = null;
      this.llmConfigured = false;
    }
  }

  _llmSetField(key, value) {
    this.llmDraft = { ...this.llmDraft, [key]: value };
  }

  async _saveLlm() {
    this.llmBusy = "save";
    this.llmNotice = null;
    this.llmError = "";
    try {
      await this._persistLlmDraft();
      this.llmNotice = {
        kind: "ok",
        text: this.llmConfigured
          ? "LLM settings saved and the assistant is configured."
          : "LLM settings saved. Enable the assistant and set a URL + model to activate it.",
      };
    } catch (err) {
      this.llmError = err.message || "Failed to save LLM settings.";
    } finally {
      this.llmBusy = null;
    }
  }

  async _testLlm() {
    this.llmBusy = "test";
    this.llmNotice = null;
    this.llmError = "";
    try {
      // The test endpoint probes the saved settings, so persist the draft
      // first — testing the form is the point of the button.
      await this._persistLlmDraft();
      const result = await api.testLlm();
      this.llmNotice = {
        kind: "ok",
        text: `Connection OK — "${result.model}" answered in ${result.latency_ms} ms.`,
      };
    } catch (err) {
      this.llmError = err.message || "Connection test failed.";
    } finally {
      this.llmBusy = null;
    }
  }

  async _persistLlmDraft() {
    const d = this.llmDraft;
    const update = {
      enabled: d.enabled,
      base_url: d.base_url.trim(),
      model: d.model.trim(),
      temperature: d.temperature.trim(),
      max_tokens: d.max_tokens.trim(),
      timeout_seconds: Number(d.timeout_seconds) || 300,
    };
    if (d.api_key.trim() !== "") update.api_key = d.api_key.trim();
    this.llm = await api.updateLlmSettings(update);
    this.llmConfigured = this.llm.configured;
    this.llmDraft = { ...this.llmDraft, api_key: "" };
  }

  _registerReset() {
    this.regForm = { ...EMPTY_REG_FORM };
  }

  async _registerSubmit(e) {
    e.preventDefault();
    const f = this.regForm;
    if (!f.name.trim() || !f.version.trim()) {
      this.error = "Name and version are required.";
      return;
    }
    let settings = {};
    if (f.default_settings.trim()) {
      try {
        const parsed = JSON.parse(f.default_settings);
        if (
          typeof parsed !== "object" || parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error("must be a JSON object");
        }
        settings = parsed;
      } catch (err) {
        this.error = `Default settings is not valid JSON: ${err.message}`;
        return;
      }
    }
    const payload = {
      name: f.name.trim(),
      version: f.version.trim(),
      backend: f.backend,
      task_types: f.tasks,
      enabled: f.enabled,
    };
    if (f.source) payload.source = f.source;
    if (f.source === "url" && f.repository_url.trim()) {
      payload.repository_url = f.repository_url.trim();
    }
    if (f.source === "local" && f.source_path.trim()) {
      payload.source_path = f.source_path.trim();
    }
    if (f.license.trim()) payload.license = f.license.trim();
    const vram = Number(f.vram_requirement_mb);
    if (f.vram_requirement_mb !== "" && Number.isFinite(vram)) {
      payload.vram_requirement_mb = vram;
    }
    const ram = Number(f.ram_requirement_mb);
    if (f.ram_requirement_mb !== "" && Number.isFinite(ram)) {
      payload.ram_requirement_mb = ram;
    }
    const deps = f.dependencies
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (deps.length > 0) payload.dependencies = deps;
    if (f.default_settings.trim()) payload.default_settings = settings;

    this.regBusy = true;
    this.error = "";
    this.notice = null;
    try {
      await api.registerModel(payload);
      this.notice = {
        kind: "ok",
        text: `"${payload.name}" registered.`,
      };
      this.showRegister = false;
      this._registerReset();
      await this._loadModels();
    } catch (err) {
      this.error = err.message || "Failed to register model.";
    } finally {
      this.regBusy = false;
    }
  }

  async _run(id, fn, noticeFn) {
    this.busyId = id;
    this.notice = null;
    this.error = "";
    try {
      const result = await fn(id);
      this.notice = { kind: "ok", text: noticeFn(result) };
      await this._loadModels();
    } catch (err) {
      this.error = err.message || "Operation failed.";
    } finally {
      this.busyId = null;
    }
  }

  async _setEnabled(m, enabled) {
    this.busyId = m.id;
    this.notice = null;
    this.error = "";
    try {
      await api.updateModel(m.id, { enabled });
      this.notice = {
        kind: "ok",
        text: `"${m.name}" ${enabled ? "enabled" : "disabled"}.`,
      };
      await this._loadModels();
    } catch (err) {
      this.error = err.message || "Failed to update model.";
    } finally {
      this.busyId = null;
    }
  }

  async _setAutoApprove(m, value) {
    this.busyId = m.id;
    this.notice = null;
    this.error = "";
    try {
      await api.updateModel(m.id, { agent_auto_approve: value });
      this.notice = {
        kind: "ok",
        text: value
          ? `"${m.name}": auto-approval ON — the copilot's model-scoped tools run without asking.`
          : `"${m.name}": auto-approval OFF — every tool call needs your approval again.`,
      };
      await this._loadModels();
    } catch (err) {
      this.error = err.message || "Failed to update model.";
    } finally {
      this.busyId = null;
    }
  }

  _install(m, needsConsent) {
    this._runConfirm({ kind: "install", model: m, needsConsent });
  }

  _remove(m) {
    this._runConfirm({ kind: "remove", model: m });
  }

  _runConfirm(state) {
    this.confirmState = state;
    this.confirmBusy = false;
  }

  _confirmSpec() {
    const st = this.confirmState;
    if (!st) return null;
    if (st.kind === "install") {
      return {
        title: "Install model",
        message: st.needsConsent
          ? `Download "${st.model.name}" from ${st.model.repository_url}?\n\nThe weights are downloaded from the network. Large models can take a long time — the download runs until it finishes.`
          : `Install "${st.model.name}"?`,
        confirmLabel: "Install",
        tone: "default",
        busyLabel: "Installing…",
      };
    }
    return {
      title: "Remove model",
      message: `Remove "${st.model.name}" and its installed files?`,
      confirmLabel: "Remove",
      tone: "danger",
      busyLabel: "Removing…",
    };
  }

  async _confirmAccept() {
    const st = this.confirmState;
    if (!st) return;
    this.confirmBusy = true;
    try {
      if (st.kind === "install") {
        await this._doInstall(st.model, st.needsConsent);
      } else {
        await this._doRemove(st.model);
      }
      this.confirmState = null;
    } finally {
      this.confirmBusy = false;
    }
  }

  _confirmDismiss() {
    if (this.confirmBusy) return;
    this.confirmState = null;
  }

  async _doInstall(m, needsConsent) {
    this.busyId = m.id;
    this.notice = null;
    this.error = "";
    try {
      const result = await api.installModel(m.id, {
        consent: needsConsent ? true : undefined,
      });
      this.notice = {
        kind: "ok",
        text: `"${m.name}" installed (file ${this._fmtBytes(result.install?.fileBytes)}).`,
      };
      await this._loadModels();
    } catch (err) {
      this.error = err.message || "Failed to install model.";
    } finally {
      this.busyId = null;
    }
  }

  async _doRemove(m) {
    this.busyId = m.id;
    this.notice = null;
    this.error = "";
    try {
      await api.deleteModel(m.id);
      this.notice = { kind: "ok", text: `"${m.name}" removed.` };
      await this._loadModels();
    } catch (err) {
      this.error = err.message || "Failed to remove model.";
    } finally {
      this.busyId = null;
    }
  }

  _renderBenchmarks(m) {
    const rows = this.benchmarks[m.id];
    if (!rows || rows.length === 0) return null;
    return html`
      <div class="bench-wrap">
        <div class="bench-head">
          <span>Benchmarks (latest runs first)</span>
        </div>
        <table class="bench-table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Duration</th>
              <th>Candidates</th>
              <th>Output</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) =>
              html`
                <tr>
                  <td>${r.task_type}</td>
                  <td>${this._fmtMs(r.duration_ms)}</td>
                  <td>${r.candidate_count}</td>
                  <td>${this._fmtBytes(r.output_bytes)}</td>
                  <td>${new Date(r.benchmarked_at).toLocaleString()}</td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  async _runBenchmark(m) {
    this.benchBusyId = m.id;
    this.notice = null;
    this.error = "";
    try {
      const { job_id, tasks } = await api.requestModelBenchmark(m.id);
      const job = await this._waitJob(job_id);
      await Promise.all([this._loadModels(), this._loadBenchmarks()]);
      if (job.status === "succeeded") {
        this.notice = {
          kind: "ok",
          text: `"${m.name}" benchmark finished: ${tasks.length} task(s), ` +
            `${job.candidate_count} candidate(s).`,
        };
      } else {
        this.error = `"${m.name}" benchmark ${job.status}: ` +
          `${job.error_text || "unknown error"}`;
      }
    } catch (err) {
      this.error = err.message || "Failed to run benchmark.";
    } finally {
      this.benchBusyId = null;
    }
  }

  async _waitJob(jobId) {
    const start = Date.now();
    for (;;) {
      const job = await api.getJob(jobId);
      if (["succeeded", "failed", "cancelled"].includes(job.status)) {
        return job;
      }
      if (Date.now() - start > 10 * 60 * 1000) {
        throw new Error("benchmark timed out");
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  _benchmarkableTasks(m) {
    return BENCHMARKABLE_TASKS.filter((t) => (m.task_types || []).includes(t));
  }

  _healthLabel(m) {
    if (!m.health_checked_at) return "never checked";
    return m.health_status === "ok" ? "healthy" : "unhealthy";
  }

  _healthClass(m) {
    if (!m.health_checked_at) return "health-unknown";
    return m.health_status === "ok" ? "health-ok" : "health-error";
  }

  _fmtMb(mb) {
    if (mb === null || mb === undefined) return "unknown";
    return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
  }

  _fmtBytes(bytes) {
    if (bytes === null || bytes === undefined) return "unknown size";
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${Math.ceil(bytes / 1024)} KB`;
  }

  _fmtMs(ms) {
    if (ms >= 60000) return `${(ms / 60000).toFixed(1)} min`;
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
    return `${ms} ms`;
  }
}

customElements.define("model-manager", ModelManager);
