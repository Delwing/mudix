-- Stubs that LuaGlobal.lua expects at module load.
luaGlobalPath = "/lua"
mudlet = {
  translations = {
    interfacelanguage = "en_US",
    en_US = {},
  },
  Locale = {
    prefixOk = { message = "[  OK  ]  - " },
    prefixWarn = { message = "[ WARN ]  - " },
    prefixInfo = { message = "[ INFO ]  - " },
    prefixError = { message = "[ ERROR ] - " },
    packageInstallSuccess = { message = "Package %s installed." },
    packageInstallFail = { message = "Couldn't install package: %s - %s" },
    moduleInstallSuccess = { message = "Module %s installed." },
    moduleInstallFail = { message = "Couldn't install module: %s - %s" },
    packageDownloading = { message = "Downloading package from: %s" },
  },
}
toNativeSeparators = function(p) return p end
