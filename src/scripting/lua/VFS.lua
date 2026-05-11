-- VFS.lua: io + lfs + dofile backed by the profile virtual filesystem
do
    local _open        = __vfs_io_open__
    local _read        = __vfs_io_read__
    local _write_fn    = __vfs_io_write__
    local _seek        = __vfs_io_seek__
    local _close_fn    = __vfs_io_close__
    local _exists      = __vfs_exists__
    local _err         = __vfs_err__
    local _profile_dir = __vfs_profile_dir__
    local _os_remove   = __vfs_os_remove__
    local _os_rename   = __vfs_os_rename__
    local _chdir       = __vfs_lfs_chdir__
    local _currentdir  = __vfs_lfs_currentdir__
    local _mkdir       = __vfs_lfs_mkdir__
    local _rmdir       = __vfs_lfs_rmdir__
    local _dir_list    = __vfs_lfs_dir__
    local _stat        = __vfs_lfs_stat__

    __vfs_io_open__        = nil
    __vfs_io_read__        = nil
    __vfs_io_write__       = nil
    __vfs_io_seek__        = nil
    __vfs_io_close__       = nil
    __vfs_exists__         = nil
    __vfs_err__            = nil
    __vfs_profile_dir__    = nil
    __vfs_os_remove__      = nil
    __vfs_os_rename__      = nil
    __vfs_lfs_chdir__      = nil
    __vfs_lfs_currentdir__ = nil
    __vfs_lfs_mkdir__      = nil
    __vfs_lfs_rmdir__      = nil
    __vfs_lfs_dir__        = nil
    __vfs_lfs_stat__       = nil

    local _handles = {}

    local function _make_handle(id)
        local mt = {
            __index = {
                read = function(self, fmt, ...)
                    local formats = {fmt or '*l', ...}
                    local out = {}
                    for i = 1, #formats do
                        out[i] = _read(id, formats[i])
                    end
                    return unpack(out)
                end,
                write = function(self, ...)
                    local args = {...}
                    for i = 1, #args do
                        local e = _write_fn(id, tostring(args[i]))
                        if e then return nil, e end
                    end
                    return self
                end,
                close = function(self)
                    local e = _close_fn(id)
                    _handles[id] = nil
                    if e then return nil, e end
                    return true
                end,
                seek = function(self, whence, offset)
                    local pos = _seek(id, whence or 'cur', offset or 0)
                    if pos == nil then return nil, _err() end
                    return pos
                end,
                lines = function(self)
                    return function()
                        local line = _read(id, '*l')
                        if line == nil then self:close() end
                        return line
                    end
                end,
                flush = function(self) return self end,
            },
            __tostring = function() return 'file (0x' .. string.format('%x', id) .. ')' end,
        }
        local f = {}
        setmetatable(f, mt)
        _handles[id] = f
        return f
    end

    io = {
        open = function(filename, mode)
            local id = _open(tostring(filename), mode or 'r')
            if not id then return nil, _err() end
            return _make_handle(id)
        end,

        close = function(file)
            if file then return file:close() end
        end,

        lines = function(filename, fmt)
            if not filename then
                error('io.lines without filename not supported', 2)
            end
            local f, e = io.open(filename, 'r')
            if not f then error(e, 2) end
            fmt = fmt or '*l'
            return function()
                local v = f:read(fmt)
                if v == nil then f:close() end
                return v
            end
        end,

        read = function()
            error('io.read (stdin) not supported', 2)
        end,

        write = function()
            error('io.write (stdout) not supported; use echo()', 2)
        end,

        type = function(obj)
            if type(obj) ~= 'table' then return nil end
            for _, h in pairs(_handles) do
                if h == obj then return 'file' end
            end
            return 'closed file'
        end,
    }

    lfs = {
        currentdir = function()
            return _currentdir()
        end,

        chdir = function(path)
            local ok = _chdir(tostring(path))
            if not ok then return nil, _err() end
            return true
        end,

        mkdir = function(path)
            local ok = _mkdir(tostring(path))
            if not ok then return nil, _err() end
            return true
        end,

        rmdir = function(path)
            local ok = _rmdir(tostring(path))
            if not ok then return nil, _err() end
            return true
        end,

        -- returns iterator: each call yields the next entry name, nil when done
        dir = function(path)
            local entries = _dir_list(tostring(path))
            if entries == nil then return nil, _err() end
            -- entries is a 0-indexed JS array
            local i = -1
            return function()
                i = i + 1
                return entries[i]
            end
        end,

        -- attrib: optional string key to return a single attribute value
        attributes = function(path, attrib)
            local s = _stat(tostring(path))
            if not s then return nil end
            local t = {
                mode         = s.type == 'dir' and 'directory' or 'file',
                size         = s.size,
                modification = s.modification,
                access       = s.access,
            }
            if attrib then return t[attrib] end
            return t
        end,

        touch = function(path)
            if not _exists(tostring(path)) then
                local f, e = io.open(path, 'w')
                if not f then return nil, e end
                f:close()
            end
            return true
        end,

        isfile = function(path)
            local s = _stat(tostring(path))
            return s ~= nil and s.type == 'file'
        end,

        isdir = function(path)
            local s = _stat(tostring(path))
            return s ~= nil and s.type == 'dir'
        end,
    }

    function getMudletHomeDir()
        return _profile_dir()
    end

    -- Lua's LUA_IDSIZE = 60 truncates `short_src` in error/traceback formatting,
    -- producing `...<tail>` for long chunknames. The profile root prefix
    -- `/profiles/<uuid>/` alone burns ~48 chars, so VFS-loaded files almost
    -- always get chopped. Strip the prefix so chunknames are VFS-relative and
    -- the error renderer can match them as hyperlinkable paths.
    local function _short_chunkname(path)
        local prefix = _profile_dir() .. '/'
        if path:sub(1, #prefix) == prefix then
            return path:sub(#prefix + 1)
        end
        return path
    end

    -- Seed package.path with the profile directory so vanilla require() works,
    -- and so user scripts can prepend extra patterns (Mudlet idiom):
    --   package.path = getMudletHomeDir() .. "/foo/?.lua;" .. package.path
    package.path = string.format(
        "%s/?.lua;%s/?/init.lua;%s",
        _profile_dir(), _profile_dir(), package.path or ""
    )

    -- VFS-backed require loader: walk package.path patterns and try each one
    -- through io.open (which is wired to the VFS above). Mirrors Lua's default
    -- loader semantics so package.path edits behave the way Mudlet packages expect.
    table.insert(package.loaders, 2, function(modname)
        local base = modname:gsub("%.", "/")
        local errs = ""
        for pattern in string.gmatch(package.path, "[^;]+") do
            local fullpath = pattern:gsub("%?", base)
            local f = io.open(fullpath, "r")
            if f then
                local code = f:read("*a")
                f:close()
                local fn, ce = loadstring(code, "@" .. _short_chunkname(fullpath))
                if not fn then error(ce) end
                return fn
            end
            errs = errs .. "\n\tno file '" .. fullpath .. "' in VFS"
        end
        return errs
    end)

    function dofile(path)
        local f, e = io.open(path, 'r')
        if not f then error(e, 2) end
        local code = f:read('*a')
        f:close()
        local chunk, ce = loadstring(code, '@' .. _short_chunkname(path))
        if not chunk then error(ce, 2) end
        return chunk()
    end

    function loadfile(path)
        local f, e = io.open(path, 'r')
        if not f then return nil, e end
        local code = f:read('*a')
        f:close()
        return loadstring(code, '@' .. _short_chunkname(path))
    end

    os.remove = function(path)
        if not _os_remove(tostring(path)) then
            return nil, _err()
        end
        return true
    end

    os.rename = function(old, new)
        if not _os_rename(tostring(old), tostring(new)) then
            return nil, _err()
        end
        return true
    end
end
