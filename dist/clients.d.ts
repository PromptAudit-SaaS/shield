import { type StructuredOptions } from './tool-calls';
export interface ClientOptions extends StructuredOptions {
    timeoutMs?: number;
}
export interface RequestOptions {
    signal?: AbortSignal;
    [key: string]: unknown;
}
export interface TextStream<T = unknown> extends AsyncIterable<T> {
    abort(): void;
}
export interface OpenAITextResponse {
    choices: {
        message: {
            content?: string | null;
            [key: string]: unknown;
        };
        [key: string]: unknown;
    }[];
    [key: string]: unknown;
}
export interface OpenAITextChunk {
    choices: {
        index: number;
        delta: {
            content?: string | null;
            [key: string]: unknown;
        };
        finish_reason?: string | null;
        [key: string]: unknown;
    }[];
    [key: string]: unknown;
}
export interface AnthropicTextResponse {
    content: {
        type: string;
        text?: string;
        [key: string]: unknown;
    }[];
    [key: string]: unknown;
}
export interface AnthropicTextEvent {
    type: string;
    index?: number;
    delta?: {
        type: string;
        text?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
interface OpenAICreate {
    (body: Record<string, unknown> & {
        stream: true;
    }, request?: RequestOptions): Promise<TextStream<OpenAITextChunk>>;
    (body: Record<string, unknown> & {
        stream?: false;
    }, request?: RequestOptions): Promise<OpenAITextResponse>;
    (body: Record<string, unknown>, request?: RequestOptions): Promise<OpenAITextResponse | TextStream<OpenAITextChunk>>;
}
interface AnthropicCreate {
    (body: Record<string, unknown> & {
        stream: true;
    }, request?: RequestOptions): Promise<TextStream<AnthropicTextEvent>>;
    (body: Record<string, unknown> & {
        stream?: false;
    }, request?: RequestOptions): Promise<AnthropicTextResponse>;
    (body: Record<string, unknown>, request?: RequestOptions): Promise<AnthropicTextResponse | TextStream<AnthropicTextEvent>>;
}
export declare function wrapOpenAI(client: unknown, options?: ClientOptions): {
    chat: {
        completions: {
            create: OpenAICreate;
        };
    };
};
export declare function wrapAnthropic(client: unknown, options?: ClientOptions): {
    messages: {
        create: AnthropicCreate;
        stream(body: Record<string, unknown>, request?: RequestOptions): Promise<TextStream<AnthropicTextEvent>>;
    };
};
export {};
