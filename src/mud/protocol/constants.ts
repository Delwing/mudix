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

// GMCP (Generic MUD Communication Protocol) negotiation sequences
export const GMCP_WILL = "\xFF\xFB\xC9"; // IAC WILL GMCP - server offers GMCP
export const GMCP_DO   = "\xFF\xFD\xC9"; // IAC DO GMCP   - client requests GMCP

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
