import { run } from "@oclif/core";

const root = process.cwd();

run(process.argv.slice(2), root).catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
