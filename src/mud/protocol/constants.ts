export const TELNET_OPTION_REGEX = /ÿú.*?ÿð|ÿ.[^ÿ]/g;

// Telnet Go Ahead / End-of-Record — used by MUDs to signal a prompt line
export const TELNET_GA  = "\xFF\xF9"; // IAC GA  (249)
export const TELNET_EOR = "\xFF\xEF"; // IAC EOR (239)
export const GMCP_COMMAND_CODE = 201;
export const GMCP_IAC = "\xFF";
export const GMCP_SB = "\xFA";
export const GMCP_SE = "\xF0";

// MCCP2 (Mud Client Compression Protocol v2)
export const MCCP2_OPTION = 0x56; // Telnet option 86

// GMCP (Generic MUD Communication Protocol) negotiation sequences
export const GMCP_WILL = "\xFF\xFB\xC9"; // IAC WILL GMCP - server offers GMCP
export const GMCP_DO   = "\xFF\xFD\xC9"; // IAC DO GMCP   - client requests GMCP

// Telnet ECHO option (RFC 857)
export const ECHO_WILL = "\xFF\xFB\x01"; // IAC WILL ECHO - server will echo (suppress local echo)
export const ECHO_WONT = "\xFF\xFC\x01"; // IAC WONT ECHO - server won't echo (restore local echo)
export const ECHO_DO   = "\xFF\xFD\x01"; // IAC DO ECHO   - client accepts server echo
export const ECHO_DONT = "\xFF\xFE\x01"; // IAC DONT ECHO - client asks server to stop echoing
