import { cpSync, mkdirSync } from "fs";
import { join } from "path";
import process from "process";

const vault = process.env.OBSIDIAN_VAULT;
if (!vault) {
	console.error("Set OBSIDIAN_VAULT to your vault path, e.g.\n  OBSIDIAN_VAULT=~/Documents/MyVault npm run install-to-vault");
	process.exit(1);
}
const dest = join(vault, ".obsidian", "plugins", "strava-periodic-note-sync");
mkdirSync(dest, { recursive: true });
for (const f of ["main.js", "manifest.json"]) cpSync(f, join(dest, f));
console.error("Installed to " + dest);
