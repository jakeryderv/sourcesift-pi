#!/usr/bin/env node
import { main } from "../src/cli.ts";

try {
	await main();
} catch (error) {
	process.stderr.write(`ssift: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exit(1);
}
