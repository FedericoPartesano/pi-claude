#!/usr/bin/env node
// Prints "regular" when Pi should run in regular mode to show images (WezTerm behind ConPTY), nothing otherwise.
// Used by bin/pi-full; cross-platform (WSL, native Windows, Linux, macOS).
import { behindConPty } from "../src/terminal.ts";

if (behindConPty(process.env, process.platform)) process.stdout.write("regular");
