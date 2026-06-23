export const TELNET_OPTION_REGEX = /ÿú[\s\S]*?ÿð|ÿ.[^ÿ]/g;

// Telnet Go Ahead / End-of-Record — used by MUDs to signal a prompt line
export const TELNET_GA  = "\xFF\xF9"; // IAC GA  (249)
export const TELNET_EOR = "\xFF\xEF"; // IAC EOR (239)
export const GMCP_COMMAND_CODE = 201;
export const GMCP_IAC = "\xFF";
export const GMCP_SB = "\xFA";
export const GMCP_SE = "\xF0";

// MCCP2 (Mud Client Compression Protocol v2)
export const MCCP2_OPTION = 0x56; // Telnet option 86

// MSDP (Mud Server Data Protocol) — telnet option 69, with MSDP_VAR/MSDP_VAL
// framing bytes inside the IAC SB … IAC SE subnegotiation. (IAC/SB/SE reuse the
// GMCP_* byte constants above — they are the generic telnet command bytes.)
export const MSDP_COMMAND_CODE = 69;
export const OPT_MSDP = "\x45"; // 69
export const MSDP_VAR = "\x01"; // 1
export const MSDP_VAL = "\x02"; // 2
// Compound-value framing: tables (string-keyed) and arrays (ordered list).
export const MSDP_TABLE_OPEN  = "\x03"; // 3
export const MSDP_TABLE_CLOSE = "\x04"; // 4
export const MSDP_ARRAY_OPEN  = "\x05"; // 5
export const MSDP_ARRAY_CLOSE = "\x06"; // 6

// MSDP negotiation sequences
export const MSDP_WILL = "\xFF\xFB\x45"; // IAC WILL MSDP - server offers MSDP
export const MSDP_DO   = "\xFF\xFD\x45"; // IAC DO MSDP   - client requests MSDP

// MSSP (Mud Server Status Protocol) — telnet option 70. Once negotiated the
// server reports status fields (player count, uptime, codebase, hostname, …)
// in a single `IAC SB MSSP MSSP_VAR <name> MSSP_VAL <value> … IAC SE`
// subnegotiation, reusing MSDP's VAR/VAL framing bytes (1/2). Typically sent
// once right after the handshake. Used by MUD-list crawlers, but a client can
// negotiate it too to read the server's self-reported status.
export const MSSP_COMMAND_CODE = 70;
export const OPT_MSSP = "\x46"; // 70
export const MSSP_VAR = "\x01"; // 1 (same byte as MSDP_VAR)
export const MSSP_VAL = "\x02"; // 2 (same byte as MSDP_VAL)
export const MSSP_WILL = "\xFF\xFB\x46"; // IAC WILL MSSP - server offers MSSP
export const MSSP_DO   = "\xFF\xFD\x46"; // IAC DO MSSP   - client requests MSSP

// GMCP (Generic MUD Communication Protocol) negotiation sequences
export const GMCP_WILL = "\xFF\xFB\xC9"; // IAC WILL GMCP - server offers GMCP
export const GMCP_DO   = "\xFF\xFD\xC9"; // IAC DO GMCP   - client requests GMCP

// ATCP (Achaea Telnet Client Protocol) — telnet option 200, GMCP's predecessor.
// Same `IAC SB <opt> <payload> IAC SE` framing as GMCP. mudix only sends it
// (sendATCP); it doesn't negotiate ATCP inbound.
export const ATCP_COMMAND_CODE = 200;
export const OPT_ATCP = "\xC8"; // 200

// zMUD "channel 102" (telnet option 102) — a generic out-of-band data channel
// some zMUD/CMUD-era servers use. `IAC SB 102 <data> IAC SE` framing.
export const TELNET_102_COMMAND_CODE = 102;
export const OPT_TELNET_102 = "\x66"; // 102

// TERMINAL-TYPE (RFC 1091) / MTTS. Servers send IAC DO TTYPE and expect the
// client to identify itself before they continue negotiating (e.g. offering
// MSDP/GMCP). The subnegotiation cycle is: server SB TTYPE SEND IAC SE, client
// replies SB TTYPE IS <name> IAC SE — repeated to walk through client name,
// terminal type, and the MTTS capability bitvector.
export const TTYPE_COMMAND_CODE = 24;       // telnet option 24
export const OPT_TTYPE   = "\x18";          // 24
export const TTYPE_IS    = "\x00";          // 0 — "this IS my type"
export const TTYPE_SEND  = "\x01";          // 1 — "SEND me your type"
export const TTYPE_DO    = "\xFF\xFD\x18";  // IAC DO TTYPE   - server requests our type
export const TTYPE_WILL  = "\xFF\xFB\x18";  // IAC WILL TTYPE - client agrees to send it

// Telnet ECHO option (RFC 857)
export const ECHO_WILL = "\xFF\xFB\x01"; // IAC WILL ECHO - server will echo (suppress local echo)
export const ECHO_WONT = "\xFF\xFC\x01"; // IAC WONT ECHO - server won't echo (restore local echo)
export const ECHO_DO   = "\xFF\xFD\x01"; // IAC DO ECHO   - client accepts server echo
export const ECHO_DONT = "\xFF\xFE\x01"; // IAC DONT ECHO - client asks server to stop echoing

// MSP (MUD Sound Protocol) — telnet option 90. Negotiation just gates the
// in-band tag stream: once the option is on, `!!SOUND(...)` and `!!MUSIC(...)`
// triplets embedded in regular MUD text trigger sound/music playback. The
// protocol predates strict telnet framing — most servers send tags inline
// without ever negotiating SB MSP — but some implementations wrap the body
// inside `IAC SB MSP ... IAC SE`, so we accept both.
export const MSP_COMMAND_CODE = 90;
export const OPT_MSP = "\x5A";             // 90
export const MSP_WILL = "\xFF\xFB\x5A";    // IAC WILL MSP - client offers MSP
export const MSP_DO   = "\xFF\xFD\x5A";    // IAC DO MSP   - client/server requests MSP

// MXP (MUD eXtension Protocol) — telnet option 91. Negotiation just gates the
// in-band markup stream: once the option is on, the server may embed HTML-like
// tags (`<B>`, `<COLOR>`, `<SEND>`, `<A>`, `<!ELEMENT>`, entities) and line-mode
// switches (`ESC[#z`) directly in the regular text, which the MxpParser turns
// into styled segments and clickable links. The `IAC SB MXP IAC SE`
// subnegotiation (option 91) carries no payload — it just confirms MXP is on;
// the real protocol is entirely in-band. Reference: https://www.zuggsoft.com/zmud/mxp.htm
export const MXP_COMMAND_CODE = 91;
export const OPT_MXP = "\x5B";             // 91
export const MXP_WILL = "\xFF\xFB\x5B";    // IAC WILL MXP - server offers MXP
export const MXP_DO   = "\xFF\xFD\x5B";    // IAC DO MXP   - client/server requests MXP

// CHARSET (RFC 2066) — telnet option 42. Either side advertises CHARSET, the
// other side accepts, then either side may send REQUEST listing IANA charset
// names; the receiver replies ACCEPTED <name> or REJECTED. The chosen encoding
// becomes the byte→char codec for both directions of the session. Modern MUDs
// use this almost exclusively to switch to UTF-8 from the telnet baseline of
// US-ASCII / Latin-1.
export const CHARSET_COMMAND_CODE = 42;
export const OPT_CHARSET = "\x2A";           // 42
export const CHARSET_REQUEST  = "\x01";      // 1 — "here are the charsets I support"
export const CHARSET_ACCEPTED = "\x02";      // 2 — "I'll use this one"
export const CHARSET_REJECTED = "\x03";      // 3 — "none of those work"
export const CHARSET_WILL = "\xFF\xFB\x2A";  // IAC WILL CHARSET
export const CHARSET_DO   = "\xFF\xFD\x2A";  // IAC DO CHARSET
