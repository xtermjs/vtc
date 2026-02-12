import { run } from "@oclif/core";

run(process.argv.slice(2), import.meta.url).catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
