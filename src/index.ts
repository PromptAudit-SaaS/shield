/** Public MIT API; no platform imports, network requests or persistence. */
export * from './engine';
export { shield } from './facade';
export { shieldMessages } from './messages';
export type { ChatMessageLike, ShieldMessagesResult, MaskedMessage, MaskedContent, MaskedPart } from './messages';
export { createUnshieldStream } from './stream';
export type { UnshieldStreamOptions } from './stream';
export { createUnshieldSseStream } from './sse';
export type { SseUnshieldOptions } from './sse';

export { CustomTermMatcher } from './custom-terms';
export { shieldStructured, shieldToolCalls } from './tool-calls';
export { wrapOpenAI, wrapAnthropic } from './clients';
export type { ShieldOptions, MaskCategory } from './session';
export type { StructuredOptions } from './tool-calls';
export type { ClientOptions, RequestOptions, TextStream, OpenAITextResponse, OpenAITextChunk, AnthropicTextResponse, AnthropicTextEvent } from './clients';
