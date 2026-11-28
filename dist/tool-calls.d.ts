import { type ShieldOptions } from './session';
export interface StructuredOptions extends ShieldOptions {
    maxDepth?: number;
    maxNodes?: number;
}
/** Plain JSON data only. Limits, cycles and accessors fail closed, never bypass masking. */
export declare function walkStructured(value: unknown, transform: (text: string) => string, options?: StructuredOptions): unknown;
/** Validate JSON, then rewrite value-string spans only: retain numeric lexemes, keys and whitespace. */
export declare function transformSerializedJson(raw: string, transform: (text: string) => string, options?: StructuredOptions): string;
export declare function shieldStructured(value: unknown, options?: StructuredOptions): {
    data: unknown;
    restore: (text: string) => string;
    clear: () => void;
    counts: Partial<Record<import("./session").MaskCategory, number>>;
};
/** Preserve tool IDs/names; rewrite only explicitly supported payload fields. */
export declare function transformToolCalls(calls: unknown, transform: (text: string) => string, options?: StructuredOptions): unknown;
export declare function shieldToolCalls(calls: unknown, options?: StructuredOptions): {
    data: unknown;
    restore: (text: string) => string;
    clear: () => void;
    counts: Partial<Record<import("./session").MaskCategory, number>>;
};
