import { describe, it, expect } from 'vitest';
import { strToU8 } from 'fflate';
import { buildMudletProfileBundle } from '../../src/import/mudletProfileImport';
import { bundleToConnectionData } from '../../src/import/applyMudletProfile';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<MudletPackage version="1.001">
  <HostPackage>
    <Host autoClearCommandLineAfterSend="yes">
      <name>Achaea</name><url>achaea.com</url><port>23</port>
      <mCommandSeparator>;;</mCommandSeparator>
    </Host>
  </HostPackage>
  <AliasPackage>
    <Alias isActive="yes" isFolder="no">
      <name>greet</name><command>say hi</command>
      <regex>^hi$</regex><script></script>
    </Alias>
  </AliasPackage>
  <VariablePackage>
    <HiddenVariables />
    <Variable><name>gold</name><keyType>4</keyType><value>500</value><valueType>3</valueType></Variable>
    <VariableGroup><name>cfg</name><keyType>4</keyType><value></value><valueType>5</valueType>
      <Variable><name>on</name><keyType>4</keyType><value>true</value><valueType>1</valueType></Variable>
    </VariableGroup>
  </VariablePackage>
</MudletPackage>`;

describe('bundleToConnectionData', () => {
    const bundle = buildMudletProfileBundle({
        'Achaea/current/2026-06-26#10-00-00.xml': strToU8(XML),
    });
    const data = bundleToConnectionData(bundle, '2026-06-26T00:00:00.000Z');

    it('maps settings from <Host>', () => {
        expect(data.profile.commandSeparator).toBe(';;');
        expect(data.profile.autoClearInput).toBe(true);
    });

    it('imports automation profile-owned (not package-tagged)', () => {
        expect(data.aliases.map(a => a.name)).toEqual(['greet']);
        // No wrapping package group — the alias sits at the root.
        expect(data.aliases.every(a => a.parentId === null)).toBe(true);
        expect(data.aliases.every(a => a.packageName === undefined)).toBe(true);
    });

    it('seeds the save-list from every top-level saved variable, with values', () => {
        expect(data.variables.saveList).toEqual(['gold', 'cfg']);
        expect(data.variables.values).toBe(bundle.profile.variables.variables);
        const cfg = data.variables.values.find(v => v.name === 'cfg');
        expect(cfg?.children?.[0]).toMatchObject({ name: 'on', valueType: 'boolean', value: 'true' });
    });
});

describe('package registration on import', () => {
    const XML_PKG = `<?xml version="1.0" encoding="UTF-8"?>
<MudletPackage version="1.001">
  <HostPackage><Host>
    <name>P</name>
    <mInstalledPackages><string>mpkg</string><string>echo</string></mInstalledPackages>
  </Host></HostPackage>
  <ScriptPackage>
    <Script isActive="yes" isFolder="no">
      <name>mpkg core</name><script>-- mpkg</script>
      <packageName>mpkg</packageName><eventHandlerList></eventHandlerList>
    </Script>
  </ScriptPackage>
</MudletPackage>`;

    const bundle = buildMudletProfileBundle({
        'P/current/2026-06-26#10-00-00.xml': strToU8(XML_PKG),
        // mpkg ships a config.lua with metadata; echo has none.
        'P/mpkg/config.lua': strToU8('mpackage = "mpkg"\nversion = "2.3.1"\nauthor = "demonnic"\ntitle = "Package Manager"\n'),
    });

    it('builds a manifest per installed package, reading config.lua metadata', () => {
        const mpkg = bundle.packages.find(p => p.name === 'mpkg');
        expect(mpkg).toMatchObject({ name: 'mpkg', version: '2.3.1', author: 'demonnic', title: 'Package Manager', kind: 'package' });
        // A package with no config.lua still registers (so getPackageInfo finds it).
        expect(bundle.packages.find(p => p.name === 'echo')).toMatchObject({ name: 'echo', kind: 'package' });
    });

    it('preserves per-node <packageName> tags on imported automation', () => {
        const node = bundle.profile.automation.scripts.find(s => s.name === 'mpkg core');
        expect(node?.packageName).toBe('mpkg');
    });

    it('stamps installedAt when applying', () => {
        const data = bundleToConnectionData(bundle, '2026-06-26T12:00:00.000Z');
        expect(data.packages.every(p => p.installedAt === '2026-06-26T12:00:00.000Z')).toBe(true);
    });
});
