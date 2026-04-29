// Core
export { EventBus } from "./core/EventBus";

// MUD session facade
export { MudSession } from "./mud/MudSession";
export type { MudSessionOptions, SessionStatus, SessionEvents } from "./mud/MudSession";

// Socket / Telnet protocol
export {
    TELNET_OPTION_REGEX,
    GMCP_COMMAND_CODE, GMCP_WILL, GMCP_DO,
    ECHO_WILL, ECHO_WONT, ECHO_DO, ECHO_DONT,
    MCCP2_OPTION,
} from "./mud/protocol/constants";
export { MccpHandler } from "./mud/protocol/mccp";
export { EchoHandler } from "./mud/protocol/echo";
export {
    createTelnetOptionParser,
    stripTelnetSequences,
    createGmcpStream,
    encodeGmcp,
} from "./mud/protocol/gmcp";
export type { GmcpEnvelope, TelnetOptionHandler, GmcpStreamOptions } from "./mud/protocol/gmcp";

// ANSI / formatting
export {
    AnsiAwareBuffer,
    cloneFormatState,
    formatStatesEqual,
} from "./mud/text/FormatState";
export type {
    FormatStateSnapshot,
    FormatColor,
    IndexedColor,
    RgbColor,
    HexColor,
    FormatHyperlink,
    DimEffect,
    DimEasing,
    BufferSegment,
    TextRange,
} from "./mud/text/FormatState";
export { colorCodes } from "./mud/text/colors";

// Output
export {
    setupOutputRenderer,
    setOutputTimestampVisibility,
    toggleOutputTimestampVisibility,
    areOutputTimestampsVisible,
    setOutputMessageTypeVisibility,
    toggleOutputMessageTypeVisibility,
    areOutputMessageTypesVisible,
} from "./ui/output/OutputRenderer";

// Client (lower-level API)
export { MudClient } from "./mud/connection/MudClient";
export type { MudClientOptions, MudClientEvents } from "./mud/connection/MudClient";
export { PingTracker } from "./mud/connection/PingTracker";
export { createPassthroughEngine } from "./mud/triggers/TriggerEngine";
export type { TriggerEngine } from "./mud/triggers/TriggerEngine";
