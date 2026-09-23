export type Mode = "copy" | "managed-block";
export type Product = "codex" | "claude-code";
export interface Entry { source: string; destination: string; mode: Mode }
export interface Manifest { schemaVersion: 1; plugin: string; product: Product; version: string; files: Entry[] }
export interface Installed extends Entry { hash: string }
export interface State { schemaVersion: 1; plugin: string; product: Product; version: string; entries: Installed[] }
export interface Operation { destination: string; beforeHash: string | null; content: string }
export interface Pending { schemaVersion: 1; manifestHash: string; beforeStateHash: string | null; nextState: State; operations: Operation[] }
export interface Action { destination: string; mode: Mode; action: "create" | "update" | "unchanged" | "retain"; reason: string }
export interface Conflict { destination: string; reason: string }
export interface Result { plugin: string; product: Product; version: string; project: string; actions: Action[]; conflicts: Conflict[]; pending: boolean; locked: boolean }
export class SetupError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); }
}
