import { type Detector } from './engine';
import { type ShieldOptions } from './session';
/** Legacy detector-array calls remain unchanged; options enable custom terms. */
export declare function shield(text: string, options?: readonly Detector[] | ShieldOptions): import("./engine").ShieldResult;
