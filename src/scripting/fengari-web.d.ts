declare module 'fengari-web' {
    type LuaState = Record<string, never>;
    type CFunction = (L: LuaState) => number;

    const lua: {
        readonly LUA_OK: number;
        readonly LUA_ERRRUN: number;
        readonly LUA_ERRSYNTAX: number;
        readonly LUA_TNIL: number;
        readonly LUA_TBOOLEAN: number;
        readonly LUA_TNUMBER: number;
        readonly LUA_TSTRING: number;
        readonly LUA_TTABLE: number;
        readonly LUA_TFUNCTION: number;
        readonly LUA_REGISTRYINDEX: number;
        lua_close(L: LuaState): void;
        lua_gettop(L: LuaState): number;
        lua_settop(L: LuaState, n: number): void;
        lua_pop(L: LuaState, n: number): void;
        lua_type(L: LuaState, idx: number): number;
        lua_pushnil(L: LuaState): void;
        lua_pushboolean(L: LuaState, b: number): void;
        lua_pushnumber(L: LuaState, n: number): void;
        lua_pushstring(L: LuaState, s: Uint8Array): Uint8Array;
        lua_pushvalue(L: LuaState, idx: number): void;
        lua_pushcfunction(L: LuaState, fn: CFunction): void;
        lua_toboolean(L: LuaState, idx: number): number;
        lua_tonumber(L: LuaState, idx: number): number;
        lua_tojsstring(L: LuaState, idx: number): string;
        lua_tostring(L: LuaState, idx: number): Uint8Array | null;
        lua_newtable(L: LuaState): void;
        lua_settable(L: LuaState, idx: number): void;
        lua_rawgeti(L: LuaState, idx: number, n: number): number;
        lua_setglobal(L: LuaState, name: Uint8Array): void;
        lua_getglobal(L: LuaState, name: Uint8Array): number;
        lua_pcall(L: LuaState, nargs: number, nresults: number, msgh: number): number;
        lua_next(L: LuaState, idx: number): number;
    };

    const lauxlib: {
        luaL_newstate(): LuaState;
        luaL_loadbuffer(
            L: LuaState,
            buff: Uint8Array,
            sz: number | null,
            name: Uint8Array | null,
        ): number;
        luaL_ref(L: LuaState, t: number): number;
        luaL_unref(L: LuaState, t: number, ref: number): void;
    };

    const lualib: {
        luaL_openlibs(L: LuaState): void;
    };

    function to_luastring(s: string, cache?: boolean): Uint8Array;
    function to_jsstring(s: Uint8Array | null): string;
}
